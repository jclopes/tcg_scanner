import { EDGE_INLIER_DISTANCE_PX, EDGE_LINE_MIN_SUPPORT_FRACTION, EDGE_MIN_CONFIDENCE, EDGE_POINT_MIN_GRADIENT } from "./constants";
import type { EdgeBandPixels, FittedLine, Point } from "./types";

/** A band as scanlines across its edge: `along` indexes the scanline,
 * `across` the position within it (rows for a left/right band). */
interface ScanGeometry {
  /** Number of scanlines. */
  length: number;
  /** Pixels per scanline. */
  thickness: number;
  /** Index step in the band's data between scanlines, and within one. */
  alongStride: number;
  acrossStride: number;
}

/** A strong transition on a scanline: `across` is its sub-pixel position,
 * `weight` its gradient strength. */
interface EdgePoint {
  along: number;
  across: number;
  weight: number;
}

/** A line in scan coordinates: across = offset + slope · (along − center). */
interface ScanLine {
  offset: number;
  slope: number;
}

/**
 * The card edge through a band (band-local coordinates), or null: gradient
 * peaks on each scanline (edgePoints) vote for lines within
 * `rotationToleranceDegrees`; the outward-most well-supported line wins, so an
 * inner parallel feature (e.g. the printed border) can't pull it inward; then
 * a weighted fit through its inliers. A band under 3px has no edge.
 */
export function fitEdgeLine(samples: EdgeBandPixels, outwardDirection: Point, rotationToleranceDegrees: number): FittedLine | null {
  const { data, width, height } = samples;
  if (data.length !== width * height) {
    throw new Error(`fitEdgeLine: expected ${width * height} bytes of band data, got ${data.length}.`);
  }
  if (width < 3 || height < 3) {
    return null;
  }

  const edgeRunsVertically = outwardDirection.x !== 0;
  const scan: ScanGeometry = edgeRunsVertically
    ? { length: height, thickness: width, alongStride: width, acrossStride: 1 }
    : { length: width, thickness: height, alongStride: 1, acrossStride: width };
  const outwardSign = edgeRunsVertically ? outwardDirection.x : outwardDirection.y;

  const points = edgePoints(data, scan);
  const line = outwardMostLine(points, scan, outwardSign, rotationToleranceDegrees);
  if (!line) {
    return null;
  }
  const inliers = inliersOf(points, line, scan.length);
  const fitted = fitWeightedLine(
    inliers.map((p) => (edgeRunsVertically ? { x: p.across, y: p.along, weight: p.weight } : { x: p.along, y: p.across, weight: p.weight })),
    inliers.length / scan.length,
  );
  return fitted && fitted.confidence >= EDGE_MIN_CONFIDENCE ? fitted : null;
}

/** Each scanline's local maxima of the Sobel gradient across the band of at
 * least EDGE_POINT_MIN_GRADIENT, at sub-pixel precision (parabola fit). */
function edgePoints(data: Uint8ClampedArray, scan: ScanGeometry): EdgePoint[] {
  const { length, thickness, alongStride, acrossStride } = scan;
  const minGradient = EDGE_POINT_MIN_GRADIENT;
  // The scanline smoothed 1-2-1 with its neighbors, then its central difference.
  const smoothed = new Int32Array(thickness);
  const gradient = new Int32Array(thickness);
  const points: EdgePoint[] = [];
  for (let along = 0; along < length; along++) {
    const prev = Math.max(along - 1, 0) * alongStride;
    const here = along * alongStride;
    const next = Math.min(along + 1, length - 1) * alongStride;
    for (let p = 0, o = 0; p < thickness; p++, o += acrossStride) {
      smoothed[p] = data[prev + o]! + 2 * data[here + o]! + data[next + o]!;
    }
    for (let p = 1; p < thickness - 1; p++) {
      gradient[p] = Math.abs(smoothed[p + 1]! - smoothed[p - 1]!);
    }
    for (let p = 1; p < thickness - 1; p++) {
      const g = gradient[p]!;
      const before = gradient[p - 1]!;
      const after = gradient[p + 1]!;
      if (g < minGradient || g < before || g <= after) {
        continue;
      }
      const curvature = before - 2 * g + after;
      const shift = curvature === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / curvature));
      points.push({ along, across: p + shift, weight: g });
    }
  }
  return points;
}

/**
 * The outward-most well-supported line, or null. Each point votes, per
 * candidate slope, for its 1-px offset bin; support is a bin plus its
 * neighbors. A line qualifies with support on EDGE_LINE_MIN_SUPPORT_FRACTION
 * of the scanlines it crosses inside the band; of those within 2 px of the
 * outward-most, the best supported wins.
 */
function outwardMostLine(points: readonly EdgePoint[], scan: ScanGeometry, outwardSign: number, rotationToleranceDegrees: number): ScanLine | null {
  const { length, thickness } = scan;
  const center = (length - 1) / 2;
  const maxSlope = Math.tan((rotationToleranceDegrees * Math.PI) / 180);
  // Adjacent candidate slopes differ by at most 2 px at the band's ends, so a
  // point on a true line lies within ~1 px of some candidate; the final fit
  // (inliersOf, fitWeightedLine) recovers the exact line.
  const slopeSteps = Math.ceil((maxSlope * center) / 2);
  const slopes = Float64Array.from({ length: 2 * slopeSteps + 1 }, (_, k) =>
    slopeSteps === 0 ? 0 : ((k - slopeSteps) / slopeSteps) * maxSlope,
  );
  const minOffset = -maxSlope * center;
  const binCount = Math.ceil(thickness + 2 * maxSlope * center) + 1;

  const votes = new Int32Array(slopes.length * binCount);
  for (const point of points) {
    const fromCenter = point.along - center;
    const shifted = point.across - minOffset;
    for (let k = 0; k < slopes.length; k++) {
      const bin = Math.floor(shifted - slopes[k]! * fromCenter);
      if (bin >= 0 && bin < binCount) {
        votes[k * binCount + bin]! += 1;
      }
    }
  }

  const minSupport = EDGE_MIN_CONFIDENCE * length;
  const offsetOf = (bin: number): number => minOffset + bin + 0.5;
  /** The support of the line at (slope k, bin), or 0 if it doesn't qualify. */
  const qualifyingSupport = (k: number, bin: number): number => {
    const at = k * binCount + bin;
    const support = votes[at]! + (bin > 0 ? votes[at - 1]! : 0) + (bin < binCount - 1 ? votes[at + 1]! : 0);
    if (support < minSupport) {
      return 0;
    }
    const inside = scanlinesInsideBand({ offset: offsetOf(bin), slope: slopes[k]! }, scan);
    return support >= EDGE_LINE_MIN_SUPPORT_FRACTION * inside ? support : 0;
  };

  let outwardBin = -1;
  for (let k = 0; k < slopes.length; k++) {
    for (let bin = 0; bin < binCount; bin++) {
      if ((outwardBin < 0 || (bin - outwardBin) * outwardSign > 0) && qualifyingSupport(k, bin) > 0) {
        outwardBin = bin;
      }
    }
  }
  if (outwardBin < 0) {
    return null;
  }

  let best: ScanLine | null = null;
  let bestSupport = 0;
  for (let k = 0; k < slopes.length; k++) {
    for (let bin = Math.max(0, outwardBin - 2); bin <= Math.min(binCount - 1, outwardBin + 2); bin++) {
      const support = qualifyingSupport(k, bin);
      if (support > bestSupport) {
        best = { offset: offsetOf(bin), slope: slopes[k]! };
        bestSupport = support;
      }
    }
  }
  return best;
}

/** How many scanlines `line` crosses within the band's thickness. */
function scanlinesInsideBand({ offset, slope }: ScanLine, scan: ScanGeometry): number {
  const center = (scan.length - 1) / 2;
  const last = scan.thickness - 1;
  if (slope === 0) {
    return offset >= 0 && offset <= last ? scan.length : 0;
  }
  const a = center + (0 - offset) / slope;
  const b = center + (last - offset) / slope;
  const from = Math.max(0, Math.min(a, b));
  const to = Math.min(scan.length - 1, Math.max(a, b));
  return to >= from ? Math.floor(to) - Math.ceil(from) + 1 : 0;
}

/** The points within EDGE_INLIER_DISTANCE_PX of `line`, at most one per
 * scanline (the closest). */
function inliersOf(points: readonly EdgePoint[], line: ScanLine, length: number): EdgePoint[] {
  const center = (length - 1) / 2;
  const closest = new Array<EdgePoint | undefined>(length);
  const closestDistance = new Float64Array(length).fill(Infinity);
  for (const point of points) {
    const distance = Math.abs(point.across - (line.offset + line.slope * (point.along - center)));
    if (distance <= EDGE_INLIER_DISTANCE_PX && distance < closestDistance[point.along]!) {
      closest[point.along] = point;
      closestDistance[point.along] = distance;
    }
  }
  return closest.filter((point): point is EdgePoint => point !== undefined);
}

/** Weighted total-least-squares line (principal eigenvector of the
 * covariance); confidence = linearity × `coverage`. Null if degenerate. */
function fitWeightedLine(points: readonly { x: number; y: number; weight: number }[], coverage: number): FittedLine | null {
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    totalWeight += p.weight;
    sumX += p.weight * p.x;
    sumY += p.weight * p.y;
  }
  if (totalWeight === 0) {
    return null;
  }
  const meanX = sumX / totalWeight;
  const meanY = sumY / totalWeight;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += p.weight * dx * dx;
    syy += p.weight * dy * dy;
    sxy += p.weight * dx * dy;
  }

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const sqrtDiscriminant = Math.sqrt(Math.max((trace * trace) / 4 - det, 0));
  const lambda1 = trace / 2 + sqrtDiscriminant;
  const lambda2 = trace / 2 - sqrtDiscriminant;

  const [rawX, rawY] = Math.abs(sxy) > 1e-9 ? [lambda1 - syy, sxy] : sxx >= syy ? [1, 0] : [0, 1];
  const norm = Math.hypot(rawX, rawY);
  if (norm < 1e-9) {
    return null;
  }

  const linearity = lambda1 + lambda2 > 1e-9 ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0;
  return {
    point: { x: meanX, y: meanY },
    direction: { x: rawX / norm, y: rawY / norm },
    confidence: Math.max(0, Math.min(1, linearity * Math.min(coverage, 1))),
  };
}

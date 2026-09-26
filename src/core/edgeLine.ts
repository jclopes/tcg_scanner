import {
  EDGE_CANNY_HIGH_THRESHOLD,
  EDGE_CANNY_LOW_THRESHOLD,
  EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD,
  EDGE_HOUGH_MAX_LINE_GAP_FRACTION,
  EDGE_HOUGH_MIN_LINE_LENGTH_FRACTION,
  EDGE_HOUGH_RHO,
  EDGE_HOUGH_THETA,
  EDGE_HOUGH_VOTE_THRESHOLD,
  EDGE_MIN_CONFIDENCE,
  EDGE_OUTWARD_GAP_TOLERANCE_FRACTION,
} from "./constants";
import type { EdgeBandPixels, FittedLine, OpenCv, Point } from "./types";

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

/**
 * Fits the dominant straight edge in a band (band-local coordinates), or
 * `null` if there is none:
 * 1. Fail fast when no scanline crosses a strong transition (`edgeScore`).
 * 2. Canny + HoughLinesP → line segments.
 * 3. Keep segments within `rotationToleranceDegrees` of the band's expected
 *    edge direction (perpendicular to `outwardDirection`).
 * 4. Keep only the outward-most cluster, so an inner parallel feature (e.g.
 *    the card's printed border) doesn't pull the fit inward.
 * 5. Length-weighted total-least-squares line through the kept segments;
 *    below EDGE_MIN_CONFIDENCE counts as not found.
 *
 * A band under 2px in either dimension (clamped at the frame edge) has no
 * edge. `samples.data` must hold exactly width * height bytes.
 */
export function fitEdgeLine(
  cv: OpenCv,
  samples: EdgeBandPixels,
  outwardDirection: Point,
  rotationToleranceDegrees: number,
): FittedLine | null {
  const { data, width, height } = samples;
  if (data.length !== width * height) {
    throw new Error(`fitEdgeLine: expected ${width * height} bytes of band data, got ${data.length}.`);
  }
  if (width < 2 || height < 2) {
    return null;
  }
  if (edgeScore(data, width, height) < EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD) {
    return null;
  }

  const plausible = filterByAngle(houghSegments(cv, samples), outwardDirection, rotationToleranceDegrees);
  if (plausible.length === 0) {
    return null;
  }

  const cluster = outwardMostCluster(plausible, outwardDirection, Math.min(width, height));
  const line = fitWeightedLine(cluster, Math.max(width, height));
  return line && line.confidence >= EDGE_MIN_CONFIDENCE ? line : null;
}

/** Absolute angle between two directions in degrees, treating a direction and
 * its negation as the same (lines have no forward). */
export function angleBetweenDirectionsDegrees(a: Point, b: Point): number {
  const dot = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  const clamped = Math.max(-1, Math.min(1, Math.abs(dot)));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Average over scanlines of each scanline's strongest pixel-to-pixel
 * transition, taking the better of rows and columns. A real edge crosses most
 * scanlines, so this stays high even though most individual pixel pairs are
 * flat (a whole-band mean gradient would be diluted to noise level).
 */
function edgeScore(data: Uint8ClampedArray, width: number, height: number): number {
  let rowMaxSum = 0;
  for (let y = 0; y < height; y++) {
    let rowMax = 0;
    for (let x = 0; x < width - 1; x++) {
      rowMax = Math.max(rowMax, Math.abs(data[y * width + x + 1]! - data[y * width + x]!));
    }
    rowMaxSum += rowMax;
  }

  let colMaxSum = 0;
  for (let x = 0; x < width; x++) {
    let colMax = 0;
    for (let y = 0; y < height - 1; y++) {
      colMax = Math.max(colMax, Math.abs(data[(y + 1) * width + x]! - data[y * width + x]!));
    }
    colMaxSum += colMax;
  }

  return Math.max(rowMaxSum / height, colMaxSum / width);
}

/** Canny + HoughLinesP over the band, returning non-degenerate segments.
 * Frees every Mat it allocates. */
function houghSegments(cv: OpenCv, samples: EdgeBandPixels): Segment[] {
  const { data, width, height } = samples;
  const longAxis = Math.max(width, height);

  const src = cv.matFromArray(height, width, cv.CV_8UC1, data);
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.Canny(src, edges, EDGE_CANNY_LOW_THRESHOLD, EDGE_CANNY_HIGH_THRESHOLD);
    cv.HoughLinesP(
      edges,
      lines,
      EDGE_HOUGH_RHO,
      EDGE_HOUGH_THETA,
      EDGE_HOUGH_VOTE_THRESHOLD,
      longAxis * EDGE_HOUGH_MIN_LINE_LENGTH_FRACTION,
      longAxis * EDGE_HOUGH_MAX_LINE_GAP_FRACTION,
    );

    // 4 int32s (x1,y1,x2,y2) per segment. This OpenCV.js build returns a
    // 1-row Mat, so the segment count is `total()`, not `rows`.
    const segments: Segment[] = [];
    for (let i = 0; i < lines.total(); i++) {
      const x1 = lines.data32S[i * 4]!;
      const y1 = lines.data32S[i * 4 + 1]!;
      const x2 = lines.data32S[i * 4 + 2]!;
      const y2 = lines.data32S[i * 4 + 3]!;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length > 0) {
        segments.push({ x1, y1, x2, y2, length });
      }
    }
    return segments;
  } finally {
    src.delete();
    edges.delete();
    lines.delete();
  }
}

/** Segments within `toleranceDegrees` of the edge direction (perpendicular to
 * the axis-aligned `outwardDirection`). */
function filterByAngle(segments: readonly Segment[], outwardDirection: Point, toleranceDegrees: number): Segment[] {
  const alongEdge: Point = { x: -outwardDirection.y, y: outwardDirection.x };
  return segments.filter(
    (segment) =>
      angleBetweenDirectionsDegrees({ x: segment.x2 - segment.x1, y: segment.y2 - segment.y1 }, alongEdge) <=
      toleranceDegrees,
  );
}

/**
 * Walks segments from the outward-most inward (by midpoint projection onto
 * `outwardDirection`) and stops at the first step gap larger than
 * EDGE_OUTWARD_GAP_TOLERANCE_FRACTION of the band's thickness. Per-step, not
 * total, so one rotated edge spread across the band stays in one cluster.
 * `segments` must be non-empty.
 */
function outwardMostCluster(segments: readonly Segment[], outwardDirection: Point, bandThickness: number): Segment[] {
  const projection = (segment: Segment): number =>
    ((segment.x1 + segment.x2) / 2) * outwardDirection.x + ((segment.y1 + segment.y2) / 2) * outwardDirection.y;

  const sorted = [...segments].sort((a, b) => projection(b) - projection(a));
  const gapTolerance = bandThickness * EDGE_OUTWARD_GAP_TOLERANCE_FRACTION;

  const cluster = [sorted[0]!];
  for (const segment of sorted.slice(1)) {
    if (projection(cluster[cluster.length - 1]!) - projection(segment) > gapTolerance) {
      break;
    }
    cluster.push(segment);
  }
  return cluster;
}

/**
 * Length-weighted total-least-squares line through the segments' endpoints:
 * direction is the principal eigenvector of the weighted covariance.
 * confidence = linearity ((λ1-λ2)/(λ1+λ2)) × coverage (total segment length /
 * `expectedLength`, capped at 1). `null` for a degenerate direction.
 */
function fitWeightedLine(segments: readonly Segment[], expectedLength: number): FittedLine | null {
  const endpoints = segments.flatMap((segment) => [
    { x: segment.x1, y: segment.y1, weight: segment.length / 2 },
    { x: segment.x2, y: segment.y2, weight: segment.length / 2 },
  ]);

  const totalWeight = endpoints.reduce((sum, p) => sum + p.weight, 0);
  const meanX = endpoints.reduce((sum, p) => sum + p.weight * p.x, 0) / totalWeight;
  const meanY = endpoints.reduce((sum, p) => sum + p.weight * p.y, 0) / totalWeight;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of endpoints) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += p.weight * dx * dx;
    syy += p.weight * dy * dy;
    sxy += p.weight * dx * dy;
  }

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const sqrtDiscriminant = Math.sqrt(Math.max(trace * trace / 4 - det, 0));
  const lambda1 = trace / 2 + sqrtDiscriminant;
  const lambda2 = trace / 2 - sqrtDiscriminant;

  const [rawX, rawY] = Math.abs(sxy) > 1e-9 ? [lambda1 - syy, sxy] : sxx >= syy ? [1, 0] : [0, 1];
  const norm = Math.hypot(rawX, rawY);
  if (norm < 1e-9) {
    return null;
  }

  const linearity = lambda1 + lambda2 > 1e-9 ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0;
  // totalWeight is the sum of all segment lengths.
  const coverage = Math.min(totalWeight / expectedLength, 1);

  return {
    point: { x: meanX, y: meanY },
    direction: { x: rawX / norm, y: rawY / norm },
    confidence: Math.max(0, Math.min(1, linearity * coverage)),
  };
}

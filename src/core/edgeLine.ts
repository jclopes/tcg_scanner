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

/**
 * Cheap fail-fast "is there any meaningful edge in this band at all" check,
 * run before the expensive Canny/HoughLinesP calls (per plan, "Fail-fast
 * within each worker").
 *
 * Deliberately *not* a plain mean gradient over the whole band: a real edge
 * is a single sharp transition, so most pixel-to-pixel differences in a band
 * are ~0 even when a strong edge is present, which would dilute a whole-band
 * average below any reasonable threshold on a band of realistic size (this
 * was caught empirically while writing fitEdgeLine's tests — a clean
 * synthetic vertical edge in a 50x160 band produced a whole-band mean
 * horizontal gradient of ~5, indistinguishable from noise). Instead, this
 * takes the max gradient *per row* (resp. per column) — the strongest
 * transition each scanline crosses — and averages those maxes. A band with
 * a real edge running most of its length has most scanlines crossing a
 * strong transition, so this stays high even though most *individual*
 * pixel-pairs are flat; a band with no edge (or just noise) has no scanline
 * with a strong transition, so this stays low.
 */
function fastEdgeScore(data: Uint8ClampedArray, width: number, height: number): number {
  let rowMaxSum = 0;
  if (width > 1) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      let rowMax = 0;
      for (let x = 0; x < width - 1; x++) {
        const diff = Math.abs(data[rowOffset + x + 1]! - data[rowOffset + x]!);
        if (diff > rowMax) rowMax = diff;
      }
      rowMaxSum += rowMax;
    }
  }
  const horizontalScore = height > 0 ? rowMaxSum / height : 0;

  let colMaxSum = 0;
  if (height > 1) {
    for (let x = 0; x < width; x++) {
      let colMax = 0;
      for (let y = 0; y < height - 1; y++) {
        const diff = Math.abs(data[(y + 1) * width + x]! - data[y * width + x]!);
        if (diff > colMax) colMax = diff;
      }
      colMaxSum += colMax;
    }
  }
  const verticalScore = width > 0 ? colMaxSum / width : 0;

  return Math.max(horizontalScore, verticalScore);
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

/** Absolute angle between two directions, in degrees, treating a direction
 * and its negation as equivalent (a line has no inherent forward) — e.g.
 * used to check a Hough segment's angle against the edge direction a band
 * expects, without caring which end of the segment is "first". */
export function angleBetweenDirectionsDegrees(a: Point, b: Point): number {
  const aNorm = Math.hypot(a.x, a.y);
  const bNorm = Math.hypot(b.x, b.y);
  const dot = (a.x * b.x + a.y * b.y) / (aNorm * bNorm);
  const clamped = Math.max(-1, Math.min(1, Math.abs(dot)));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Fits the dominant straight edge line within a band's pixel data.
 *
 * Algorithm (per plan, "Detection strategy" — per-edge line fitting, never
 * full-contour/corner detection):
 * 1. Fail-fast: reject immediately (return null) if the band has no
 *    meaningful gradient at all (flat/near-uniform pixels) — cheaper than
 *    running Canny/HoughLinesP on every frame.
 * 2. Canny edge detection, then HoughLinesP to find straight-line segments.
 * 3. If no segments were found, return null ("edge-not-found").
 * 4. Reject segments whose angle isn't plausibly this edge: the band's
 *    expected edge direction is known ahead of time (perpendicular to
 *    `outwardDirection`, which is axis-aligned), up to
 *    `rotationToleranceDegrees` of card rotation. A segment further
 *    off-angle than that (a shadow, a reflection, a scratch) can't be the
 *    real edge regardless of how strong or well-placed it is, so it's
 *    dropped before the outward-preference step below ever sees it. If
 *    nothing survives, return null ("edge-not-found").
 * 5. Prefer the outward-most edge: a band can contain more than one strong
 *    linear feature passing the angle check — the card's true physical
 *    edge, plus (since the band is deliberately widened by
 *    position/zoom/rotation tolerance) possibly an inner feature closer to
 *    the card's interior, e.g. its own printed border or artwork frame,
 *    that happens to run roughly parallel to it. Blending both
 *    indiscriminately would pull the fit inward, off the true edge.
 *    Instead, the surviving segments are sorted by how far "outward" (per
 *    `outwardDirection`) each one sits and walked from the outward-most
 *    one inward, stopping as soon as one step's gap exceeds
 *    EDGE_OUTWARD_GAP_TOLERANCE_FRACTION — a real further-in feature is
 *    separated from the true edge by a visible gap, whereas fragments of
 *    one real edge (even one spread out across the band by rotation) stay
 *    close together step to step. Everything from that gap inward is
 *    discarded before fitting, the same as if it were noise.
 * 6. Combine the kept cluster's segments (there may be several short,
 *    fragmented segments — e.g. a finger occluding part of the edge) into a
 *    single robust line via a weighted total-least-squares fit: each
 *    segment contributes its two endpoints, weighted by the segment's
 *    length, and the fitted line's direction is the dominant eigenvector of
 *    the resulting 2x2 weighted-covariance matrix (i.e. the endpoint
 *    scatter's principal axis).
 * 7. Confidence combines two [0,1] measures:
 *    - "linearity": (λ1-λ2)/(λ1+λ2) of the covariance's eigenvalues — 1 when
 *      all endpoints lie exactly on a line, lower when they're scattered.
 *    - "coverage": kept segments' total length / the band's long-axis
 *      dimension, capped at 1 — how much of the expected edge length was
 *      actually found (segments discarded as "further inward" don't count
 *      toward this).
 *    confidence = linearity * coverage. If below EDGE_MIN_CONFIDENCE, the
 *    fit is treated as not-found (returns null) rather than as a usable but
 *    weak line.
 *
 * `point`/`direction` are returned in the same pixel coordinate space as
 * `samples` (i.e. band-local, origin at samples' (0,0)) — the caller is
 * responsible for translating into frame coordinates (by adding the band's
 * region.origin) before calling intersectLines across two different bands.
 *
 * Takes the already-initialized OpenCV.js instance explicitly (dependency
 * injection) rather than importing/awaiting a global — see OpenCv's doc
 * comment in types.ts.
 */
export function fitEdgeLine(
  cv: OpenCv,
  samples: EdgeBandPixels,
  outwardDirection: Point,
  rotationToleranceDegrees: number,
): FittedLine | null {
  const { data, width, height } = samples;
  if (width < 2 || height < 2 || data.length !== width * height) {
    return null;
  }

  if (fastEdgeScore(data, width, height) < EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD) {
    return null;
  }

  const longAxis = Math.max(width, height);
  const shortAxis = Math.min(width, height);

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

    // HoughLinesP's output Mat packs one segment (4 int32s: x1,y1,x2,y2) per
    // element; the *number of segments* is reliably `lines.total()`
    // (rows*cols) rather than `lines.rows` — this OpenCV.js build returns a
    // 1-row Mat with one column per segment (not one row per segment as the
    // C++ docs' Nx1 convention might suggest), confirmed empirically before
    // writing this.
    const segmentCount = lines.total();
    if (segmentCount === 0) {
      return null;
    }

    const allSegments: Segment[] = [];
    for (let i = 0; i < segmentCount; i++) {
      const base = i * 4;
      const x1 = lines.data32S[base]!;
      const y1 = lines.data32S[base + 1]!;
      const x2 = lines.data32S[base + 2]!;
      const y2 = lines.data32S[base + 3]!;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length <= 0) continue;
      allSegments.push({ x1, y1, x2, y2, length });
    }

    if (allSegments.length === 0) {
      return null;
    }

    // Step 4: drop segments that can't plausibly be this edge by angle
    // alone. The expected edge direction is outwardDirection rotated 90° —
    // it's always axis-aligned, so the rotation is exact, no trig needed.
    const alongEdgeDirection: Point = { x: -outwardDirection.y, y: outwardDirection.x };
    const plausibleSegments = allSegments.filter((segment) => {
      const segmentDirection: Point = { x: segment.x2 - segment.x1, y: segment.y2 - segment.y1 };
      return angleBetweenDirectionsDegrees(segmentDirection, alongEdgeDirection) <= rotationToleranceDegrees;
    });

    if (plausibleSegments.length === 0) {
      return null;
    }

    // A segment's position along outwardDirection — its midpoint's
    // projection, one representative number per segment (see step 5 above).
    const outwardProjection = (segment: Segment): number =>
      ((segment.x1 + segment.x2) / 2) * outwardDirection.x + ((segment.y1 + segment.y2) / 2) * outwardDirection.y;

    const sortedByOutward = [...plausibleSegments].sort(
      (a, b) => outwardProjection(b) - outwardProjection(a),
    );
    const gapTolerance = shortAxis * EDGE_OUTWARD_GAP_TOLERANCE_FRACTION;
    const segments: Segment[] = [sortedByOutward[0]!];
    let previousProjection = outwardProjection(sortedByOutward[0]!);
    for (let i = 1; i < sortedByOutward.length; i++) {
      const segment = sortedByOutward[i]!;
      const projection = outwardProjection(segment);
      if (previousProjection - projection > gapTolerance) {
        break;
      }
      segments.push(segment);
      previousProjection = projection;
    }

    let totalLength = 0;
    for (const seg of segments) {
      totalLength += seg.length;
    }

    // Weighted mean of all segment endpoints (each endpoint weighted by
    // half its segment's length, so each segment contributes weight
    // proportional to its length overall).
    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;
    for (const seg of segments) {
      const weight = seg.length / 2;
      sumWeight += weight * 2;
      sumX += weight * (seg.x1 + seg.x2);
      sumY += weight * (seg.y1 + seg.y2);
    }
    const meanX = sumX / sumWeight;
    const meanY = sumY / sumWeight;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const seg of segments) {
      const weight = seg.length / 2;
      for (const [px, py] of [
        [seg.x1, seg.y1],
        [seg.x2, seg.y2],
      ] as const) {
        const dx = px - meanX;
        const dy = py - meanY;
        sxx += weight * dx * dx;
        syy += weight * dy * dy;
        sxy += weight * dx * dy;
      }
    }

    const trace = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const discriminant = Math.max(trace * trace / 4 - det, 0);
    const sqrtDiscriminant = Math.sqrt(discriminant);
    const lambda1 = trace / 2 + sqrtDiscriminant;
    const lambda2 = trace / 2 - sqrtDiscriminant;

    let dirX: number;
    let dirY: number;
    if (Math.abs(sxy) > 1e-9) {
      dirX = lambda1 - syy;
      dirY = sxy;
    } else if (sxx >= syy) {
      dirX = 1;
      dirY = 0;
    } else {
      dirX = 0;
      dirY = 1;
    }
    const norm = Math.hypot(dirX, dirY);
    if (norm < 1e-9) {
      return null;
    }
    dirX /= norm;
    dirY /= norm;

    const linearity = lambda1 + lambda2 > 1e-9 ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0;
    const coverage = Math.min(totalLength / longAxis, 1);
    const confidence = Math.max(0, Math.min(1, linearity * coverage));

    if (confidence < EDGE_MIN_CONFIDENCE) {
      return null;
    }

    return {
      point: { x: meanX, y: meanY },
      direction: { x: dirX, y: dirY },
      confidence,
    };
  } finally {
    src.delete();
    edges.delete();
    lines.delete();
  }
}

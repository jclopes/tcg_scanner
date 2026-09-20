import type { FittedLine, Point, QuadValidationResult, ToleranceConfig } from "./types";

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Intersects two fitted lines (point + direction form) and returns their
 * intersection point. Used to reconstruct the 4 quad corners from the 4
 * fitted edge lines — never sampled directly from the image (see plan,
 * "Corner reconstruction").
 *
 * Both lines must be expressed in the same coordinate space (typically frame
 * coordinates — see fitEdgeLine's doc comment on translating band-local
 * points).
 *
 * Judgment call: the plan's contract returns a plain `Point`, not
 * `Point | null`, so there's no way to signal "no unique intersection".
 * Adjacent guide edges are expected to be roughly perpendicular in practice,
 * so a (near-)parallel pair indicates a genuine invariant violation (e.g.
 * the caller paired two opposite edges by mistake, or a degenerate fit) —
 * this throws rather than silently returning NaN/Infinity, per this
 * project's "explicit over implicit" principle.
 */
export function intersectLines(a: FittedLine, b: FittedLine): Point {
  const denom = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
  if (Math.abs(denom) < 1e-9) {
    throw new Error(
      "intersectLines: lines are parallel (or nearly parallel) and have no unique intersection",
    );
  }

  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const t = (dx * b.direction.y - dy * b.direction.x) / denom;

  return {
    x: a.point.x + t * a.direction.x,
    y: a.point.y + t * a.direction.y,
  };
}

/**
 * Validates a reconstructed quad against the target card aspect ratio.
 *
 * Corner order: `corners` is assumed to be
 * [topLeft, topRight, bottomRight, bottomLeft] (clockwise, matching
 * expectedEdgeBands' [top, right, bottom, left] band order and
 * computePerspectiveTransform's expected corner order).
 *
 * Only checks aspect ratio (per plan: "Reject ... if the resulting quad's
 * side-length ratio falls outside the tolerance band around the target
 * aspect ratio"). It does not, and is not asked to, independently re-check
 * per-edge confidence or "edge not found" — see QuadValidationResult's doc
 * comment in types.ts for why "edge-not-found" is the caller's
 * responsibility, produced before validateQuad would even be called.
 */
export function validateQuad(
  corners: [Point, Point, Point, Point],
  targetAspectRatio: number,
  tolerance: ToleranceConfig,
): QuadValidationResult {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  const topLength = distance(topLeft, topRight);
  const bottomLength = distance(bottomRight, bottomLeft);
  const leftLength = distance(bottomLeft, topLeft);
  const rightLength = distance(topRight, bottomRight);

  const avgWidth = (topLength + bottomLength) / 2;
  const avgHeight = (leftLength + rightLength) / 2;

  if (!Number.isFinite(avgWidth) || !Number.isFinite(avgHeight) || avgWidth <= 0 || avgHeight <= 0) {
    return { valid: false, corners: null, reason: "aspect-ratio-out-of-tolerance" };
  }

  const shortSide = Math.min(avgWidth, avgHeight);
  const longSide = Math.max(avgWidth, avgHeight);
  const measuredRatio = shortSide / longSide;

  const relativeDeviation = Math.abs(measuredRatio - targetAspectRatio) / targetAspectRatio;

  if (relativeDeviation > tolerance.aspectRatioTolerance) {
    return { valid: false, corners: null, reason: "aspect-ratio-out-of-tolerance" };
  }

  return { valid: true, corners };
}

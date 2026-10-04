import type { FittedLine, PerEdge, Point, Quad, Size, ToleranceConfig } from "./types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Where two point + direction lines cross; null when (nearly) parallel. */
export function intersectLines(a: FittedLine, b: FittedLine): Point | null {
  const denom = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
  if (Math.abs(denom) < 1e-9) {
    return null;
  }

  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const t = (dx * b.direction.y - dy * b.direction.x) / denom;

  return {
    x: a.point.x + t * a.direction.x,
    y: a.point.y + t * a.direction.y,
  };
}

/** A quad's corners from its [top, right, bottom, left] edge lines; null if
 * adjacent edges are parallel. */
export function quadFromEdgeLines(lines: PerEdge<FittedLine>): Quad | null {
  const [top, right, bottom, left] = lines;
  const topLeft = intersectLines(top, left);
  const topRight = intersectLines(top, right);
  const bottomRight = intersectLines(bottom, right);
  const bottomLeft = intersectLines(bottom, left);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    return null;
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

/** Short side / long side, from the averaged opposite sides; NaN for a
 * degenerate quad. */
export function quadAspectRatio(corners: Quad): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  const avgWidth = (distance(topLeft, topRight) + distance(bottomRight, bottomLeft)) / 2;
  const avgHeight = (distance(bottomLeft, topLeft) + distance(topRight, bottomRight)) / 2;

  if (!Number.isFinite(avgWidth) || !Number.isFinite(avgHeight) || avgWidth <= 0 || avgHeight <= 0) {
    return NaN;
  }
  return Math.min(avgWidth, avgHeight) / Math.max(avgWidth, avgHeight);
}

/** Whether the quad's aspect ratio is within `tolerance.aspectRatioTolerance`
 * (relative deviation) of `targetAspectRatio`. A degenerate quad is invalid. */
export function isQuadAspectRatioValid(corners: Quad, targetAspectRatio: number, tolerance: ToleranceConfig): boolean {
  const aspectRatio = quadAspectRatio(corners);
  if (Number.isNaN(aspectRatio)) {
    return false;
  }
  return Math.abs(aspectRatio - targetAspectRatio) / targetAspectRatio <= tolerance.aspectRatioTolerance;
}

/** The axis-aligned box around a quad's corners. */
export function quadBoundingBox(corners: Quad): { origin: Point; size: Size } {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const origin = { x: Math.min(...xs), y: Math.min(...ys) };
  return { origin, size: { width: Math.max(...xs) - origin.x, height: Math.max(...ys) - origin.y } };
}

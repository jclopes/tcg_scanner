import type { FittedLine, Point, Quad, ToleranceConfig } from "./types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Intersection of two lines given in point + direction form (same coordinate
 * space). `null` when they're (nearly) parallel and have no unique
 * intersection.
 */
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

/**
 * Reconstructs a quad's corners from its 4 edge lines ([top, right, bottom,
 * left], frame coordinates). `null` if any pair of adjacent edges is parallel.
 */
export function quadFromEdgeLines(lines: readonly [FittedLine, FittedLine, FittedLine, FittedLine]): Quad | null {
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

/**
 * A quad's aspect ratio as short side / long side (orientation independent),
 * from its averaged opposite side lengths. `NaN` for a degenerate quad.
 */
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
  const relativeDeviation = Math.abs(quadAspectRatio(corners) - targetAspectRatio) / targetAspectRatio;
  return relativeDeviation <= tolerance.aspectRatioTolerance;
}

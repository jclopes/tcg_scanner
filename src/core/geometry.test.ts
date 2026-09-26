import { describe, expect, it } from "vitest";
import { intersectLines, isQuadAspectRatioValid, quadFromEdgeLines } from "./geometry";
import type { FittedLine, Point, Quad, ToleranceConfig } from "./types";

function line(point: Point, direction: Point, confidence = 1): FittedLine {
  return { point, direction, confidence };
}

function rectangleCorners(width: number, height: number, origin: Point = { x: 0, y: 0 }): Quad {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

const TOLERANCE: ToleranceConfig = {
  rotationToleranceDegrees: 5,
  aspectRatioTolerance: 0.08,
};

describe("intersectLines", () => {
  it("intersects a horizontal and a vertical line at the expected point", () => {
    const horizontal = line({ x: 0, y: 5 }, { x: 1, y: 0 });
    const vertical = line({ x: 5, y: 0 }, { x: 0, y: 1 });

    const result = intersectLines(horizontal, vertical)!;

    expect(result.x).toBeCloseTo(5, 6);
    expect(result.y).toBeCloseTo(5, 6);
  });

  it("works with non-unit direction vectors", () => {
    const horizontal = line({ x: 2, y: 3 }, { x: 10, y: 0 });
    const vertical = line({ x: 7, y: -4 }, { x: 0, y: -20 });

    const result = intersectLines(horizontal, vertical)!;

    expect(result.x).toBeCloseTo(7, 6);
    expect(result.y).toBeCloseTo(3, 6);
  });

  it("is unaffected by flipping a direction vector's sign", () => {
    const a = line({ x: 0, y: 0 }, { x: 1, y: 1 });
    const b1 = line({ x: 0, y: 4 }, { x: 1, y: -1 });
    const b2 = line({ x: 0, y: 4 }, { x: -1, y: 1 });

    const result1 = intersectLines(a, b1)!;
    const result2 = intersectLines(a, b2)!;

    expect(result1.x).toBeCloseTo(result2.x, 6);
    expect(result1.y).toBeCloseTo(result2.y, 6);
    expect(result1.x).toBeCloseTo(2, 6);
    expect(result1.y).toBeCloseTo(2, 6);
  });

  it("finds the intersection of two arbitrary angled lines", () => {
    // y = x  (through origin, 45deg)
    const a = line({ x: 0, y: 0 }, { x: 1, y: 1 });
    // y = -2x + 9  -> direction (1, -2), passing through (0, 9)
    const b = line({ x: 0, y: 9 }, { x: 1, y: -2 });

    // Solve x = -2x + 9 -> 3x = 9 -> x = 3, y = 3
    const result = intersectLines(a, b)!;

    expect(result.x).toBeCloseTo(3, 6);
    expect(result.y).toBeCloseTo(3, 6);
  });

  it("returns null for parallel lines", () => {
    const a = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const b = line({ x: 0, y: 10 }, { x: 2, y: 0 });

    expect(intersectLines(a, b)).toBeNull();
  });

  it("returns null for nearly-parallel lines within the epsilon", () => {
    const a = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const b = line({ x: 0, y: 10 }, { x: 1, y: 1e-12 });

    expect(intersectLines(a, b)).toBeNull();
  });
});

describe("quadFromEdgeLines", () => {
  it("reconstructs a rectangle's corners from its 4 edge lines", () => {
    const top = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const right = line({ x: 10, y: 0 }, { x: 0, y: 1 });
    const bottom = line({ x: 0, y: 20 }, { x: 1, y: 0 });
    const left = line({ x: 0, y: 0 }, { x: 0, y: 1 });

    expect(quadFromEdgeLines([top, right, bottom, left])).toEqual(rectangleCorners(10, 20));
  });

  it("returns null when two adjacent edges are parallel", () => {
    const horizontal = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const vertical = line({ x: 0, y: 0 }, { x: 0, y: 1 });

    expect(quadFromEdgeLines([horizontal, horizontal, horizontal, vertical])).toBeNull();
  });
});

describe("isQuadAspectRatioValid", () => {
  const targetAspectRatio = 63 / 88;

  it("accepts a rectangle exactly matching the target aspect ratio", () => {
    expect(isQuadAspectRatioValid(rectangleCorners(63, 88), targetAspectRatio, TOLERANCE)).toBe(true);
  });

  it("accepts a rectangle in landscape orientation with the same aspect ratio", () => {
    expect(isQuadAspectRatioValid(rectangleCorners(88, 63), targetAspectRatio, TOLERANCE)).toBe(true);
  });

  it("accepts a slightly perturbed quad within tolerance", () => {
    const corners: Quad = [
      { x: 2, y: -1 },
      { x: 64, y: 1 },
      { x: 63, y: 89 },
      { x: -1, y: 87 },
    ];
    expect(isQuadAspectRatioValid(corners, targetAspectRatio, TOLERANCE)).toBe(true);
  });

  it("rejects a quad whose aspect ratio is outside tolerance (too square)", () => {
    expect(isQuadAspectRatioValid(rectangleCorners(80, 88), targetAspectRatio, TOLERANCE)).toBe(false);
  });

  it("rejects a quad whose aspect ratio is outside tolerance (too narrow)", () => {
    expect(isQuadAspectRatioValid(rectangleCorners(40, 88), targetAspectRatio, TOLERANCE)).toBe(false);
  });

  it("rejects a degenerate quad (all corners coincident)", () => {
    const point = { x: 5, y: 5 };
    expect(isQuadAspectRatioValid([point, point, point, point], targetAspectRatio, TOLERANCE)).toBe(false);
  });

  it("respects a wider aspect-ratio tolerance", () => {
    const looseTolerance: ToleranceConfig = { ...TOLERANCE, aspectRatioTolerance: 0.5 };
    expect(isQuadAspectRatioValid(rectangleCorners(80, 88), targetAspectRatio, looseTolerance)).toBe(true);
  });
});

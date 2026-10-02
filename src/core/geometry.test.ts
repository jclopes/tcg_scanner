import { describe, expect, it } from "vitest";
import { intersectLines, isQuadAspectRatioValid, quadFromEdgeLines } from "./geometry";
import type { FittedLine, Point, Quad, ToleranceConfig } from "./types";

function line(point: Point, direction: Point): FittedLine {
  return { point, direction, confidence: 1 };
}

function rectangle(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

describe("intersectLines", () => {
  it("intersects two angled lines, whatever the length or sign of their directions", () => {
    // y = x and y = -2x + 9 meet at (3, 3).
    const a = line({ x: 0, y: 0 }, { x: 1, y: 1 });
    for (const direction of [
      { x: 1, y: -2 },
      { x: -10, y: 20 },
    ]) {
      const result = intersectLines(a, line({ x: 0, y: 9 }, direction))!;
      expect(result.x).toBeCloseTo(3, 6);
      expect(result.y).toBeCloseTo(3, 6);
    }
  });

  it("returns null for parallel or nearly parallel lines", () => {
    const a = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(intersectLines(a, line({ x: 0, y: 10 }, { x: 2, y: 0 }))).toBeNull();
    expect(intersectLines(a, line({ x: 0, y: 10 }, { x: 1, y: 1e-12 }))).toBeNull();
  });
});

describe("quadFromEdgeLines", () => {
  it("reconstructs the corners, in [topLeft, topRight, bottomRight, bottomLeft] order, from [top, right, bottom, left] lines", () => {
    const top = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const right = line({ x: 10, y: 0 }, { x: 0, y: 1 });
    const bottom = line({ x: 0, y: 20 }, { x: 1, y: 0 });
    const left = line({ x: 0, y: 0 }, { x: 0, y: 1 });
    expect(quadFromEdgeLines([top, right, bottom, left])).toEqual(rectangle(10, 20));
  });

  it("returns null when two adjacent edges are parallel", () => {
    const horizontal = line({ x: 0, y: 0 }, { x: 1, y: 0 });
    const vertical = line({ x: 0, y: 0 }, { x: 0, y: 1 });
    expect(quadFromEdgeLines([horizontal, horizontal, horizontal, vertical])).toBeNull();
  });
});

describe("isQuadAspectRatioValid", () => {
  const cardRatio = 63 / 88;
  const tolerance: ToleranceConfig = { rotationToleranceDegrees: 5, aspectRatioTolerance: 0.08 };

  it("accepts a card-shaped quad in either orientation, and one slightly skewed by perspective", () => {
    expect(isQuadAspectRatioValid(rectangle(63, 88), cardRatio, tolerance)).toBe(true);
    expect(isQuadAspectRatioValid(rectangle(88, 63), cardRatio, tolerance)).toBe(true);
    const skewed: Quad = [
      { x: 2, y: -1 },
      { x: 64, y: 1 },
      { x: 63, y: 89 },
      { x: -1, y: 87 },
    ];
    expect(isQuadAspectRatioValid(skewed, cardRatio, tolerance)).toBe(true);
  });

  it("rejects a quad outside the tolerance, too square or too narrow, unless the tolerance allows it", () => {
    expect(isQuadAspectRatioValid(rectangle(80, 88), cardRatio, tolerance)).toBe(false);
    expect(isQuadAspectRatioValid(rectangle(40, 88), cardRatio, tolerance)).toBe(false);
    expect(isQuadAspectRatioValid(rectangle(80, 88), cardRatio, { ...tolerance, aspectRatioTolerance: 0.5 })).toBe(true);
  });

  it("rejects a degenerate quad", () => {
    const point = { x: 5, y: 5 };
    expect(isQuadAspectRatioValid([point, point, point, point], cardRatio, tolerance)).toBe(false);
  });
});

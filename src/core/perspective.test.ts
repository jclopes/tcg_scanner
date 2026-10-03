import { describe, expect, it } from "vitest";
import { computePerspectiveTransform } from "./perspective";
import { applyMatrix3x3 } from "./regionWarp";
import type { Quad } from "./types";

describe("computePerspectiveTransform", () => {
  it("maps each corner of a skewed quad onto the matching corner of the output rectangle", () => {
    const corners: Quad = [
      { x: 20, y: 10 },
      { x: 300, y: 30 },
      { x: 280, y: 400 },
      { x: 5, y: 380 },
    ];
    const matrix = computePerspectiveTransform(corners, { width: 63, height: 88 });

    const expected = [
      { x: 0, y: 0 },
      { x: 63, y: 0 },
      { x: 63, y: 88 },
      { x: 0, y: 88 },
    ];
    corners.forEach((corner, i) => {
      const mapped = applyMatrix3x3(matrix, corner);
      expect(mapped.x).toBeCloseTo(expected[i]!.x, 2);
      expect(mapped.y).toBeCloseTo(expected[i]!.y, 2);
    });
  });

  it("throws for a degenerate quad", () => {
    const point = { x: 5, y: 5 };
    expect(() => computePerspectiveTransform([point, point, point, point], { width: 63, height: 88 })).toThrow(/Degenerate/);
  });
});

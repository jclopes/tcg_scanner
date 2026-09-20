import { beforeAll, describe, expect, it } from "vitest";
import { computePerspectiveTransform } from "./perspective";
import { loadOpenCv } from "./testSupport/openCv";
import type { OpenCv, Point } from "./types";

let cv: OpenCv;

beforeAll(async () => {
  cv = await loadOpenCv();
});

/** Applies a Matrix3x3 (row-major, homogeneous) to a 2D point. */
function applyTransform(matrix: readonly (readonly number[])[], point: Point): Point {
  const row0 = matrix[0]!;
  const row1 = matrix[1]!;
  const row2 = matrix[2]!;
  const x = row0[0]! * point.x + row0[1]! * point.y + row0[2]!;
  const y = row1[0]! * point.x + row1[1]! * point.y + row1[2]!;
  const w = row2[0]! * point.x + row2[1]! * point.y + row2[2]!;
  return { x: x / w, y: y / w };
}

describe("computePerspectiveTransform", () => {
  it("maps an already axis-aligned rectangle to a pure scale (identity-shaped) transform", () => {
    const corners: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 140 },
      { x: 0, y: 140 },
    ];
    const outputSize = { width: 50, height: 70 };

    const matrix = computePerspectiveTransform(cv, corners, outputSize);

    for (const corner of corners) {
      const mapped = applyTransform(matrix, corner);
      const expected = {
        x: (corner.x / 100) * outputSize.width,
        y: (corner.y / 140) * outputSize.height,
      };
      expect(mapped.x).toBeCloseTo(expected.x, 3);
      expect(mapped.y).toBeCloseTo(expected.y, 3);
    }
  });

  it("maps a skewed (perspective) quad's corners exactly onto the output rectangle's corners", () => {
    const corners: [Point, Point, Point, Point] = [
      { x: 20, y: 10 }, // top-left, nudged right
      { x: 300, y: 30 }, // top-right, nudged down (simulating tilt)
      { x: 280, y: 400 }, // bottom-right
      { x: 5, y: 380 }, // bottom-left
    ];
    const outputSize = { width: 63, height: 88 };
    const expectedOutputs: Point[] = [
      { x: 0, y: 0 },
      { x: outputSize.width, y: 0 },
      { x: outputSize.width, y: outputSize.height },
      { x: 0, y: outputSize.height },
    ];

    const matrix = computePerspectiveTransform(cv, corners, outputSize);

    corners.forEach((corner, i) => {
      const mapped = applyTransform(matrix, corner);
      const expected = expectedOutputs[i]!;
      expect(mapped.x).toBeCloseTo(expected.x, 2);
      expect(mapped.y).toBeCloseTo(expected.y, 2);
    });
  });

  it("returns a 3x3 matrix shape", () => {
    const corners: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 63, y: 0 },
      { x: 63, y: 88 },
      { x: 0, y: 88 },
    ];

    const matrix = computePerspectiveTransform(cv, corners, { width: 63, height: 88 });

    expect(matrix).toHaveLength(3);
    for (const row of matrix) {
      expect(row).toHaveLength(3);
    }
  });
});

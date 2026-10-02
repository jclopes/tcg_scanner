import { beforeAll, describe, expect, it } from "vitest";
import { computePerspectiveTransform } from "./perspective";
import { applyMatrix3x3 } from "./regionWarp";
import { loadOpenCv } from "./testSupport/openCv";
import type { OpenCv, Quad } from "./types";

let cv: OpenCv;

beforeAll(async () => {
  cv = await loadOpenCv();
});

// The homography math is OpenCV's; what's ours is the corner ordering and
// reading the result back as a row-major matrix.
describe("computePerspectiveTransform", () => {
  it("maps each corner of a skewed quad onto the matching corner of the output rectangle", () => {
    const corners: Quad = [
      { x: 20, y: 10 },
      { x: 300, y: 30 },
      { x: 280, y: 400 },
      { x: 5, y: 380 },
    ];
    const matrix = computePerspectiveTransform(cv, corners, { width: 63, height: 88 });

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
});

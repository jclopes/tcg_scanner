import { describe, expect, it } from "vitest";
import type { ImageRegionConfig } from "./identification";
import { applyMatrix3x3, invertMatrix3x3, regionWarpMatrix } from "./regionWarp";
import type { Matrix3x3, Point } from "./types";

const IDENTITY: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function region(overrides: Partial<ImageRegionConfig>): ImageRegionConfig {
  return { label: "r", type: "image", xMm: 0, yMm: 0, widthMm: 10, heightMm: 5, rotationDeg: 0, ...overrides };
}

function expectMapsTo(matrix: Matrix3x3, from: Point, to: Point): void {
  const mapped = applyMatrix3x3(matrix, from);
  expect(mapped.x).toBeCloseTo(to.x, 6);
  expect(mapped.y).toBeCloseTo(to.y, 6);
}

describe("regionWarpMatrix", () => {
  it("maps an unrotated region of an upright card to its pixel box", () => {
    // Frame pixels are 10x the card's mm.
    const frameToCardMm: Matrix3x3 = [
      [0.1, 0, 0],
      [0, 0.1, 0],
      [0, 0, 1],
    ];
    const m = regionWarpMatrix(frameToCardMm, "portrait", "portrait", region({ xMm: 10, yMm: 20 }), 26);

    expectMapsTo(m, { x: 100, y: 200 }, { x: 0, y: 0 });
    expectMapsTo(m, { x: 150, y: 220 }, { x: 130, y: 52 });
  });

  it("turns a card lying sideways in a landscape frame upright (its top faces left)", () => {
    // In the frame the card is 88 x 63 mm; its top-left corner is at the frame's bottom-left.
    const m = regionWarpMatrix(IDENTITY, "landscape", "portrait", region({}), 1);

    expectMapsTo(m, { x: 0, y: 63 }, { x: 0, y: 0 });
    expectMapsTo(m, { x: 0, y: 0 }, { x: 63, y: 0 });
    expectMapsTo(m, { x: 88, y: 63 }, { x: 0, y: 88 });
  });

  it("measures a rotated region in the frame of the whole card rotated by rotationDeg", () => {
    // Rotating the upright card by -90° (counter-clockwise) puts its top-right corner at the top-left.
    const m = regionWarpMatrix(IDENTITY, "portrait", "portrait", region({ rotationDeg: -90 }), 1);

    expectMapsTo(m, { x: 63, y: 0 }, { x: 0, y: 0 });
    expectMapsTo(m, { x: 0, y: 0 }, { x: 0, y: 63 });
  });

  it("rotates about the card's center into its rotated bounding box for non-right angles", () => {
    const m = regionWarpMatrix(IDENTITY, "portrait", "portrait", region({ rotationDeg: 45 }), 1);
    const boundingSize = (63 + 88) * Math.SQRT1_2;

    expectMapsTo(m, { x: 31.5, y: 44 }, { x: boundingSize / 2, y: boundingSize / 2 });
  });
});

describe("invertMatrix3x3", () => {
  it("undoes a perspective transform", () => {
    const m: Matrix3x3 = [
      [1.2, 0.1, 30],
      [-0.05, 0.9, 12],
      [0.0004, -0.0002, 1],
    ];
    const point = { x: 140, y: 75 };
    expectMapsTo(invertMatrix3x3(m), applyMatrix3x3(m, point), point);
  });
});

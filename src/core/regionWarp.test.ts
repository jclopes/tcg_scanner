import { describe, expect, it } from "vitest";
import type { RegionConfig } from "./identification";
import { applyMatrix3x3, cardSizeMm, multiplyMatrix3x3, regionOutputSize, regionWarpMatrix } from "./regionWarp";
import type { Matrix3x3, Point } from "./types";

const IDENTITY: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function region(overrides: Partial<RegionConfig>): RegionConfig {
  return { label: "r", type: "text", xMm: 0, yMm: 0, widthMm: 10, heightMm: 5, ...overrides };
}

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe("multiplyMatrix3x3 / applyMatrix3x3", () => {
  it("applies the right-hand matrix first", () => {
    const scale2: Matrix3x3 = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 1],
    ];
    const shiftX: Matrix3x3 = [
      [1, 0, 5],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expectPointClose(applyMatrix3x3(multiplyMatrix3x3(scale2, shiftX), { x: 1, y: 1 }), { x: 12, y: 2 });
  });

  it("divides by the homogeneous coordinate", () => {
    const halve: Matrix3x3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 2],
    ];
    expectPointClose(applyMatrix3x3(halve, { x: 4, y: 6 }), { x: 2, y: 3 });
  });
});

describe("regionWarpMatrix", () => {
  it("maps an unrotated region of an upright card to its pixel box", () => {
    // Frame pixels are 10x the card's mm.
    const frameToCardMm: Matrix3x3 = [
      [0.1, 0, 0],
      [0, 0.1, 0],
      [0, 0, 1],
    ];
    const m = regionWarpMatrix(frameToCardMm, "portrait", "portrait", region({ xMm: 10, yMm: 20 }), 26);

    expectPointClose(applyMatrix3x3(m, { x: 100, y: 200 }), { x: 0, y: 0 });
    expectPointClose(applyMatrix3x3(m, { x: 150, y: 220 }), { x: 130, y: 52 });
  });

  it("turns a card lying sideways in a landscape frame upright (its top faces left)", () => {
    // In the frame the card is 88 x 63 mm; its top-left corner is at the frame's bottom-left.
    const m = regionWarpMatrix(IDENTITY, "landscape", "portrait", region({}), 1);

    expectPointClose(applyMatrix3x3(m, { x: 0, y: 63 }), { x: 0, y: 0 });
    expectPointClose(applyMatrix3x3(m, { x: 0, y: 0 }), { x: 63, y: 0 });
    expectPointClose(applyMatrix3x3(m, { x: 88, y: 63 }), { x: 0, y: 88 });
  });

  it("measures a rotated region in the frame of the whole card rotated by rotationDeg", () => {
    // Rotating the upright card by -90° (counter-clockwise) puts its top-right corner at the top-left.
    const m = regionWarpMatrix(IDENTITY, "portrait", "portrait", region({ rotationDeg: -90 }), 1);

    expectPointClose(applyMatrix3x3(m, { x: 63, y: 0 }), { x: 0, y: 0 });
    expectPointClose(applyMatrix3x3(m, { x: 0, y: 0 }), { x: 0, y: 63 });
  });

  it("rotates about the card's center into its rotated bounding box for non-right angles", () => {
    const m = regionWarpMatrix(IDENTITY, "portrait", "portrait", region({ rotationDeg: 45 }), 1);
    const boundingSize = (63 + 88) * Math.SQRT1_2;

    expectPointClose(applyMatrix3x3(m, { x: 31.5, y: 44 }), { x: boundingSize / 2, y: boundingSize / 2 });
  });
});

describe("regionOutputSize / cardSizeMm", () => {
  it("sizes the region at the given density", () => {
    expect(regionOutputSize(region({ widthMm: 12.6, heightMm: 3.9 }), 26)).toEqual({ width: 328, height: 101 });
  });

  it("gives the card's mm size for each orientation", () => {
    expect(cardSizeMm("portrait")).toEqual({ width: 63, height: 88 });
    expect(cardSizeMm("landscape")).toEqual({ width: 88, height: 63 });
  });
});

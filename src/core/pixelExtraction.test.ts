import { describe, expect, it } from "vitest";
import { clampRegion, extractGrayscaleRegion, type RgbaPixelBuffer } from "./pixelExtraction";

/** A `width` x `height` RGBA buffer from row-major [r, g, b] pixels. */
function buffer(width: number, height: number, pixels: [number, number, number][]): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  return { data, width, height };
}

describe("clampRegion", () => {
  const size = { width: 100, height: 50 };

  it("rounds a region to whole pixels", () => {
    expect(clampRegion({ origin: { x: 10.4, y: 5.6 }, size: { width: 20.2, height: 10 } }, size)).toEqual({
      x0: 10,
      y0: 6,
      width: 21,
      height: 10,
    });
  });

  it("clamps a region crossing the source's edges", () => {
    expect(clampRegion({ origin: { x: -5, y: 40 }, size: { width: 20, height: 30 } }, size)).toEqual({
      x0: 0,
      y0: 40,
      width: 15,
      height: 10,
    });
  });

  it("gives zero size for a region entirely outside the source", () => {
    expect(clampRegion({ origin: { x: 120, y: 10 }, size: { width: 10, height: 10 } }, size).width).toBe(0);
  });
});

describe("extractGrayscaleRegion", () => {
  it("converts to grayscale with Rec. 601 luma weights", () => {
    const source = buffer(5, 1, [
      [255, 255, 255],
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    const band = extractGrayscaleRegion(source, { origin: { x: 0, y: 0 }, size: { width: 5, height: 1 } });
    expect(Array.from(band.data)).toEqual([255, 0, 76, 150, 29]);
  });

  it("crops the clamped region and reports its clamped origin, for translating band coordinates back", () => {
    const source = buffer(2, 2, [
      [10, 10, 10],
      [20, 20, 20],
      [30, 30, 30],
      [40, 40, 40],
    ]);
    const band = extractGrayscaleRegion(source, { origin: { x: -1, y: 0 }, size: { width: 2, height: 2 } });
    expect(band).toEqual({ data: new Uint8ClampedArray([10, 30]), width: 1, height: 2, origin: { x: 0, y: 0 } });
  });
});

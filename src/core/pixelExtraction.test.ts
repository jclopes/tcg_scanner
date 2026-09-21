import { describe, expect, it } from "vitest";
import { extractGrayscaleRegion, type RgbaPixelBuffer } from "./pixelExtraction";

/** Builds a w x h RGBA buffer from a row-major list of [r,g,b,a] pixels. */
function buildBuffer(width: number, height: number, pixels: [number, number, number, number][]): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { data, width, height };
}

describe("extractGrayscaleRegion", () => {
  it("converts known colors to grayscale using Rec. 601 luma weights", () => {
    // 1x5 source: white, black, red, green, blue.
    const source = buildBuffer(5, 1, [
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]);
    const result = extractGrayscaleRegion(source, { origin: { x: 0, y: 0 }, size: { width: 5, height: 1 } });
    expect(result.width).toBe(5);
    expect(result.height).toBe(1);
    expect(Array.from(result.data)).toEqual([255, 0, 76, 150, 29]);
  });

  it("extracts a sub-region at a non-zero origin", () => {
    // 3x3 source; extract the center 1x1 pixel.
    const source = buildBuffer(3, 3, [
      [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [200, 0, 0, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255],
    ]);
    const result = extractGrayscaleRegion(source, { origin: { x: 1, y: 1 }, size: { width: 1, height: 1 } });
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.data[0]).toBe(Math.round(0.299 * 200));
    expect(result.origin).toEqual({ x: 1, y: 1 });
  });

  it("clamps a region that extends past the source's right/bottom bounds", () => {
    const source = buildBuffer(2, 2, [
      [10, 10, 10, 255], [20, 20, 20, 255],
      [30, 30, 30, 255], [40, 40, 40, 255],
    ]);
    // Requested region is 4x4 starting at (0,0) — larger than the 2x2 source.
    const result = extractGrayscaleRegion(source, { origin: { x: 0, y: 0 }, size: { width: 4, height: 4 } });
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.data)).toEqual([10, 20, 30, 40]);
    // Clamped on the right/bottom, not the origin corner — origin is unchanged.
    expect(result.origin).toEqual({ x: 0, y: 0 });
  });

  it("clamps a region whose origin is negative (extends past the top/left bounds), and reports the clamped origin", () => {
    const source = buildBuffer(2, 2, [
      [10, 10, 10, 255], [20, 20, 20, 255],
      [30, 30, 30, 255], [40, 40, 40, 255],
    ]);
    const result = extractGrayscaleRegion(source, { origin: { x: -1, y: -1 }, size: { width: 2, height: 2 } });
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(Array.from(result.data)).toEqual([10]);
    // The requested origin was (-1,-1); a caller translating a line fit
    // against this data back into the source's coordinate space must use
    // this clamped (0,0), not the requested (-1,-1), or it'll be off by
    // exactly the clamped amount (the bug this field exists to prevent).
    expect(result.origin).toEqual({ x: 0, y: 0 });
  });

  it("returns a zero-size result for a region entirely outside the source bounds", () => {
    const source = buildBuffer(2, 2, [
      [10, 10, 10, 255], [20, 20, 20, 255],
      [30, 30, 30, 255], [40, 40, 40, 255],
    ]);
    const result = extractGrayscaleRegion(source, { origin: { x: 10, y: 10 }, size: { width: 5, height: 5 } });
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.data.length).toBe(0);
  });

  it("rounds fractional origin/size to the nearest pixel", () => {
    const source = buildBuffer(4, 1, [
      [1, 1, 1, 255], [2, 2, 2, 255], [3, 3, 3, 255], [4, 4, 4, 255],
    ]);
    // origin.x = 1.4 rounds to 1; size.width = 2.4 -> x1 = round(1.4+2.4)=round(3.8)=4
    const result = extractGrayscaleRegion(source, { origin: { x: 1.4, y: 0 }, size: { width: 2.4, height: 1 } });
    expect(result.width).toBe(3);
    expect(Array.from(result.data)).toEqual([2, 3, 4]);
  });

  it("produces data.length === width * height, matching EdgeBandPixels' contract", () => {
    const source = buildBuffer(3, 3, new Array(9).fill([5, 5, 5, 255]));
    const result = extractGrayscaleRegion(source, { origin: { x: 0, y: 0 }, size: { width: 3, height: 3 } });
    expect(result.data.length).toBe(result.width * result.height);
  });
});

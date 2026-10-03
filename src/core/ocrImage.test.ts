import { describe, expect, it } from "vitest";
import { bilateralFilter, prepareTextForOcr } from "./ocrImage";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { GrayscalePixels } from "./types";

describe("bilateralFilter", () => {
  it("smooths small noise but keeps a strong edge sharp", () => {
    // 20 x 10: left half ~30, right half ~220, each pixel nudged by ±8.
    const width = 20;
    const height = 10;
    const data = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i % width < 10 ? 30 : 220) + (i % 3 === 0 ? 8 : -8);
    }
    const filtered = bilateralFilter({ data, width, height }, 2, 50, 50);

    const spread = (image: GrayscalePixels, x0: number, x1: number): number => {
      const values = Array.from({ length: height * (x1 - x0) }, (_, i) => image.data[Math.floor(i / (x1 - x0)) * width + x0 + (i % (x1 - x0))]!);
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread(filtered, 0, 8)).toBeLessThan(spread({ data, width, height }, 0, 8));
    // The columns on either side of the edge stay at their side's level.
    for (let y = 0; y < height; y++) {
      expect(filtered.data[y * width + 9]).toBeLessThan(50);
      expect(filtered.data[y * width + 10]).toBeGreaterThan(200);
    }
  });
});

describe("prepareTextForOcr", () => {
  it("turns light text on a dark background into dark text on a light one", () => {
    // 10 x 10 dark image with a light 2-px bar of "text".
    const rgba: RgbaPixelBuffer = { data: new Uint8ClampedArray(400), width: 10, height: 10 };
    for (let i = 0; i < 100; i++) {
      const value = i % 10 >= 4 && i % 10 < 6 ? 240 : 20;
      rgba.data.set([value, value, value, 255], i * 4);
    }
    const { gray, inverted } = prepareTextForOcr(rgba);

    expect(inverted).toBe(true);
    expect(gray.data[0]).toBeGreaterThan(200); // background now light
    expect(gray.data[4]).toBeLessThan(60); // text now dark
  });
});

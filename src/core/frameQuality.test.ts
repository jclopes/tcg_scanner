import { describe, expect, it } from "vitest";
import { laplacianVariance, selectBestFrame } from "./frameQuality";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { Quad } from "./types";

/** A checkerboard of `low`/`high` grays: edge content whose strength is the
 * contrast between them (equal values give a flat frame). */
function checkerboard(size: number, low: number, high: number): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let i = 0; i < size * size; i++) {
    const gray = (Math.floor(i / size) + (i % size)) % 2 === 0 ? low : high;
    data.fill(gray, i * 4, i * 4 + 3);
  }
  return { data, width: size, height: size };
}

function rectangle(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

describe("laplacianVariance", () => {
  it("is zero for a flat frame and higher the sharper (more contrasted) the detail", () => {
    expect(laplacianVariance(checkerboard(10, 128, 128))).toBe(0);
    expect(laplacianVariance(checkerboard(10, 0, 255))).toBeGreaterThan(laplacianVariance(checkerboard(10, 100, 155)));
  });
});

describe("selectBestFrame", () => {
  const cardRatio = 63 / 88;

  it("prefers the sharper frame when the quads are equally card-shaped", () => {
    const blurry = { corners: rectangle(100, 140), cardPixels: checkerboard(20, 100, 155) };
    const sharp = { corners: rectangle(100, 140), cardPixels: checkerboard(20, 0, 255) };
    expect(selectBestFrame([blurry, sharp], cardRatio)).toBe(sharp);
  });

  it("prefers the more card-shaped quad when the frames are equally sharp", () => {
    const wellShaped = { corners: rectangle(100, 140), cardPixels: checkerboard(20, 0, 255) };
    const badlyShaped = { corners: rectangle(100, 200), cardPixels: checkerboard(20, 0, 255) };
    expect(selectBestFrame([badlyShaped, wellShaped], cardRatio)).toBe(wellShaped);
  });
});

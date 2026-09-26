import { describe, expect, it } from "vitest";
import { laplacianVariance, selectBestFrame } from "./frameQuality";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { Point } from "./types";

/** A uniform-color frame — no edge content, so laplacianVariance should be
 * (near) zero regardless of size or color. */
function solidFrame(width: number, height: number, gray: number): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = gray;
    data[i * 4 + 1] = gray;
    data[i * 4 + 2] = gray;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** A checkerboard frame — maximum-frequency edge content, so
 * laplacianVariance should be large and, at a fixed size, larger the more
 * contrast there is between the two colors. */
function checkerboardFrame(width: number, height: number, low: number, high: number): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const gray = (x + y) % 2 === 0 ? low : high;
      data[i * 4] = gray;
      data[i * 4 + 1] = gray;
      data[i * 4 + 2] = gray;
      data[i * 4 + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("laplacianVariance", () => {
  it("is zero for a uniform (flat) frame", () => {
    expect(laplacianVariance(solidFrame(10, 10, 128))).toBe(0);
  });

  it("is large and positive for a high-frequency (checkerboard) frame", () => {
    expect(laplacianVariance(checkerboardFrame(10, 10, 0, 255))).toBeGreaterThan(0);
  });

  it("scores a higher-contrast checkerboard as sharper than a lower-contrast one of the same size", () => {
    const lowContrast = laplacianVariance(checkerboardFrame(10, 10, 100, 155));
    const highContrast = laplacianVariance(checkerboardFrame(10, 10, 0, 255));
    expect(highContrast).toBeGreaterThan(lowContrast);
  });

  it("returns 0 for a frame too small to have any interior pixel", () => {
    expect(laplacianVariance(solidFrame(2, 2, 128))).toBe(0);
  });
});

/** Axis-aligned quad corners for a `width` x `height` card, in
 * [topLeft, topRight, bottomRight, bottomLeft] order. */
function rectCorners(width: number, height: number): [Point, Point, Point, Point] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

describe("selectBestFrame", () => {
  const targetAspectRatio = 0.7159; // standard card ratio

  it("returns the only candidate when given exactly one", () => {
    const only = { corners: rectCorners(100, 140), cardPixels: solidFrame(10, 10, 0) };
    expect(selectBestFrame([only], targetAspectRatio)).toBe(only);
  });

  it("prefers the sharper candidate when quad geometry is equally good", () => {
    const blurry = { corners: rectCorners(100, 140), cardPixels: checkerboardFrame(20, 20, 100, 155) };
    const sharp = { corners: rectCorners(100, 140), cardPixels: checkerboardFrame(20, 20, 0, 255) };
    expect(selectBestFrame([blurry, sharp], targetAspectRatio)).toBe(sharp);
  });

  it("prefers the candidate whose quad better matches the target aspect ratio when sharpness is equal", () => {
    const wellMatched = { corners: rectCorners(100, 140), cardPixels: checkerboardFrame(20, 20, 0, 255) }; // ~0.714
    const badlyMatched = { corners: rectCorners(100, 200), cardPixels: checkerboardFrame(20, 20, 0, 255) }; // 0.5
    expect(selectBestFrame([badlyMatched, wellMatched], targetAspectRatio)).toBe(wellMatched);
  });

  it("throws on an empty candidate list", () => {
    expect(() => selectBestFrame([], targetAspectRatio)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { laplacianVariance, selectBestFrame } from "./frameQuality";
import type { RgbaPixelBuffer } from "./pixelExtraction";

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

describe("selectBestFrame", () => {
  it("returns the only frame when given exactly one", () => {
    const only = solidFrame(10, 10, 0);
    expect(selectBestFrame([only], 0.7159)).toBe(only);
  });

  it("prefers the sharper frame when aspect ratios are equally good", () => {
    const blurry = checkerboardFrame(100, 140, 100, 155);
    const sharp = checkerboardFrame(100, 140, 0, 255);
    expect(selectBestFrame([blurry, sharp], 100 / 140)).toBe(sharp);
  });

  it("prefers the frame whose aspect ratio better matches the target when sharpness is equal", () => {
    const targetAspectRatio = 0.7159; // standard card ratio
    const wellMatched = checkerboardFrame(100, 140, 0, 255); // ratio ~0.714
    const badlyMatched = checkerboardFrame(100, 200, 0, 255); // ratio 0.5
    expect(selectBestFrame([badlyMatched, wellMatched], targetAspectRatio)).toBe(wellMatched);
  });

  it("throws on an empty frame list", () => {
    expect(() => selectBestFrame([], 0.7159)).toThrow();
  });
});

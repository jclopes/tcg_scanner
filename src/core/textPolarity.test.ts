import { describe, expect, it } from "vitest";
import { isLightTextOnDark, otsuThreshold } from "./textPolarity";
import type { GrayscalePixels } from "./types";

/** A 10x10 image of `background` whose first `textPixels` pixels are `ink`. */
function image(background: number, ink: number, textPixels: number): GrayscalePixels {
  const data = new Uint8ClampedArray(100).fill(background);
  data.fill(ink, 0, textPixels);
  return { data, width: 10, height: 10 };
}

describe("otsuThreshold", () => {
  it("splits two gray levels between them", () => {
    const threshold = otsuThreshold(image(200, 40, 30));
    expect(threshold).toBeGreaterThanOrEqual(40);
    expect(threshold).toBeLessThan(200);
  });
});

describe("isLightTextOnDark", () => {
  it("is false for dark text on a light background", () => {
    expect(isLightTextOnDark(image(230, 20, 25))).toBe(false);
  });

  it("is true for light text on a dark background", () => {
    expect(isLightTextOnDark(image(25, 210, 25))).toBe(true);
  });
});

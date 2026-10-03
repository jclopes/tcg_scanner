import { describe, expect, it } from "vitest";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { Matrix3x3 } from "./types";
import { warpPerspective } from "./warp";

/** A `width` x 1 image whose pixel x is gray `values[x]`, fully opaque. */
function row(values: number[]): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, x) => data.set([value, value, value, 255], x * 4));
  return { data, width: values.length, height: 1 };
}

/** Each output pixel's red channel and alpha. */
function grays(image: RgbaPixelBuffer): [number, number][] {
  return Array.from({ length: image.width * image.height }, (_, i) => [image.data[i * 4]!, image.data[i * 4 + 3]!]);
}

function shiftX(dx: number): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

describe("warpPerspective", () => {
  const source = row([0, 40, 80, 120, 160]);

  it("reproduces the source exactly under the identity, bilinear or bicubic", () => {
    for (const interpolation of ["bilinear", "bicubic"] as const) {
      expect(warpPerspective(source, shiftX(0), { width: 5, height: 1 }, interpolation)).toEqual(source);
    }
  });

  it("moves pixels by the transform, leaving positions outside the source transparent", () => {
    const shifted = warpPerspective(source, shiftX(2), { width: 5, height: 1 }, "bilinear");
    expect(grays(shifted)).toEqual([
      [0, 0],
      [0, 0],
      [0, 255],
      [40, 255],
      [80, 255],
    ]);
  });

  it("interpolates between pixels", () => {
    // Output pixel u samples source x = u + 0.5.
    const halfway = warpPerspective(source, shiftX(-0.5), { width: 4, height: 1 }, "bilinear");
    expect(grays(halfway).map(([gray]) => gray)).toEqual([20, 60, 100, 140]);
  });
});

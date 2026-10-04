import type { RgbaPixelBuffer } from "./pixelExtraction";
import { invertMatrix3x3 } from "./regionWarp";
import type { Matrix3x3, Size } from "./types";

export type Interpolation = "bilinear" | "bicubic";

/** `source` warped by `sourceToOutput` onto an `outputSize` image, bilinear or
 * bicubic (OpenCV's INTER_CUBIC: sharper glyphs when upsampling), with
 * OpenCV's pixel centers; outside the source is transparent black. */
export function warpPerspective(
  source: RgbaPixelBuffer,
  sourceToOutput: Matrix3x3,
  outputSize: Size,
  interpolation: Interpolation,
): RgbaPixelBuffer {
  const { width, height } = outputSize;
  const data = new Uint8ClampedArray(width * height * 4);
  const [[a, b, c], [d, e, f], [g, h, i]] = invertMatrix3x3(sourceToOutput);
  const maxX = source.width - 1;
  const maxY = source.height - 1;
  const sample = interpolation === "bilinear" ? sampleBilinear : sampleBicubic;
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const w = g * u + h * v + i;
      const x = (a * u + b * v + c) / w;
      const y = (d * u + e * v + f) / w;
      if (x >= 0 && x <= maxX && y >= 0 && y <= maxY) {
        sample(source, x, y, data, (v * width + u) * 4);
      }
    }
  }
  return { data, width, height };
}

/** Writes the bilinear sample of `source` at (x, y), inside the source, to
 * `out[offset..offset+3]`. */
function sampleBilinear(source: RgbaPixelBuffer, x: number, y: number, out: Uint8ClampedArray, offset: number): void {
  const { data, width } = source;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, source.height - 1);
  const top = y0 * width;
  const bottom = y1 * width;
  for (let ch = 0; ch < 4; ch++) {
    const topValue = data[(top + x0) * 4 + ch]! * (1 - fx) + data[(top + x1) * 4 + ch]! * fx;
    const bottomValue = data[(bottom + x0) * 4 + ch]! * (1 - fx) + data[(bottom + x1) * 4 + ch]! * fx;
    out[offset + ch] = topValue * (1 - fy) + bottomValue * fy;
  }
}

/** Writes the bicubic sample of `source` at (x, y), inside the source, to
 * `out[offset..offset+3]`, from the 4×4 pixels around it. */
function sampleBicubic(source: RgbaPixelBuffer, x: number, y: number, out: Uint8ClampedArray, offset: number): void {
  const { data, width, height } = source;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // Column offsets (in RGBA bytes) and weights for x0-1 .. x0+2, edges repeated.
  const c0 = Math.max(x0 - 1, 0) * 4;
  const c1 = x0 * 4;
  const c2 = Math.min(x0 + 1, width - 1) * 4;
  const c3 = Math.min(x0 + 2, width - 1) * 4;
  const wx0 = cubicWeight(1 + fx);
  const wx1 = cubicWeight(fx);
  const wx2 = cubicWeight(1 - fx);
  const wx3 = cubicWeight(2 - fx);
  // Row offsets and weights for y0-1 .. y0+2.
  const rowBytes = width * 4;
  const r0 = Math.max(y0 - 1, 0) * rowBytes;
  const r1 = y0 * rowBytes;
  const r2 = Math.min(y0 + 1, height - 1) * rowBytes;
  const r3 = Math.min(y0 + 2, height - 1) * rowBytes;
  const wy0 = cubicWeight(1 + fy);
  const wy1 = cubicWeight(fy);
  const wy2 = cubicWeight(1 - fy);
  const wy3 = cubicWeight(2 - fy);
  for (let ch = 0; ch < 4; ch++) {
    const a = c0 + ch;
    const b = c1 + ch;
    const c = c2 + ch;
    const d = c3 + ch;
    out[offset + ch] =
      wy0 * (wx0 * data[r0 + a]! + wx1 * data[r0 + b]! + wx2 * data[r0 + c]! + wx3 * data[r0 + d]!) +
      wy1 * (wx0 * data[r1 + a]! + wx1 * data[r1 + b]! + wx2 * data[r1 + c]! + wx3 * data[r1 + d]!) +
      wy2 * (wx0 * data[r2 + a]! + wx1 * data[r2 + b]! + wx2 * data[r2 + c]! + wx3 * data[r2 + d]!) +
      wy3 * (wx0 * data[r3 + a]! + wx1 * data[r3 + b]! + wx2 * data[r3 + c]! + wx3 * data[r3 + d]!);
  }
}

/** Keys' cubic convolution kernel with a = −0.75 (OpenCV's INTER_CUBIC), for
 * a tap `t` ≥ 0 pixels away. */
function cubicWeight(t: number): number {
  const a = -0.75;
  if (t <= 1) {
    return ((a + 2) * t - (a + 3)) * t * t + 1;
  }
  if (t < 2) {
    return ((a * t - 5 * a) * t + 8 * a) * t - 4 * a;
  }
  return 0;
}

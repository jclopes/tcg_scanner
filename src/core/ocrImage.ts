import { OCR_DENOISE_RADIUS_PX, OCR_DENOISE_SIGMA_COLOR, OCR_DENOISE_SIGMA_SPACE } from "./constants";
import { extractGrayscaleRegion } from "./pixelExtraction";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import { isLightTextOnDark } from "./textPolarity";
import type { GrayscalePixels } from "./types";

/** A text crop prepared for Tesseract: grayscale, inverted to dark-on-light
 * when needed, denoised. */
export function prepareTextForOcr(rgba: RgbaPixelBuffer): { gray: GrayscalePixels; inverted: boolean } {
  const { data, width, height } = extractGrayscaleRegion(rgba, {
    origin: { x: 0, y: 0 },
    size: { width: rgba.width, height: rgba.height },
  });
  const gray = { data, width, height };
  const inverted = isLightTextOnDark(gray);
  if (inverted) {
    for (let i = 0; i < data.length; i++) {
      data[i] = 255 - data[i]!;
    }
  }
  return {
    gray: bilateralFilter(gray, OCR_DENOISE_RADIUS_PX, OCR_DENOISE_SIGMA_COLOR, OCR_DENOISE_SIGMA_SPACE),
    inverted,
  };
}

/** Edge-preserving smoothing: each pixel averages its neighbors within
 * `radius`, weighted by distance and by similarity, so edges stay sharp.
 * Borders reflect (OpenCV's BORDER_DEFAULT). */
export function bilateralFilter(
  pixels: GrayscalePixels,
  radius: number,
  sigmaColor: number,
  sigmaSpace: number,
): GrayscalePixels {
  const { data, width, height } = pixels;
  const colorWeights = Float64Array.from({ length: 256 }, (_, d) => Math.exp(-(d * d) / (2 * sigmaColor * sigmaColor)));
  const offsetsX: number[] = [];
  const offsetsY: number[] = [];
  const spaceWeights: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsetsX.push(dx);
        offsetsY.push(dy);
        spaceWeights.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace)));
      }
    }
  }

  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = data[y * width + x]!;
      let sum = 0;
      let weightSum = 0;
      for (let k = 0; k < spaceWeights.length; k++) {
        const value = data[reflect(y + offsetsY[k]!, height) * width + reflect(x + offsetsX[k]!, width)]!;
        const weight = spaceWeights[k]! * colorWeights[Math.abs(value - center)]!;
        sum += weight * value;
        weightSum += weight;
      }
      out[y * width + x] = sum / weightSum;
    }
  }
  return { data: out, width, height };
}

/** Index `i` reflected back into `[0, size)` without repeating the edge pixel
 * (…, 2, 1 | 0, 1, 2, … | n-2, n-3, …). */
function reflect(i: number, size: number): number {
  if (i < 0) {
    return Math.min(-i, size - 1);
  }
  if (i >= size) {
    return Math.max(2 * size - 2 - i, 0);
  }
  return i;
}

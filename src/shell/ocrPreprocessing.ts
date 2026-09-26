import { isLightTextOnDark } from "../core";
import type { OpenCv } from "../core";
import { createCanvas } from "./canvasUtils";

/**
 * Prepares a text crop for Tesseract: grayscale, inverted to dark-on-light
 * when the text is light on dark (`isLightTextOnDark`), then a bilateral
 * filter — edge-preserving denoising that, in testing against real captures,
 * read as well as a 1.5× denser warp at a fraction of the cost (binarization,
 * sharpening, median and higher densities were compared and dropped).
 */
export function prepareForOcr(cv: OpenCv, textCanvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; inverted: boolean } {
  const rgba = cv.imread(textCanvas);
  const gray = new cv.Mat();
  const denoised = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const inverted = isLightTextOnDark({
      data: new Uint8ClampedArray(gray.data),
      width: gray.cols,
      height: gray.rows,
    });
    if (inverted) {
      cv.bitwise_not(gray, gray);
    }
    cv.bilateralFilter(gray, denoised, 5, 50, 50, cv.BORDER_DEFAULT);

    const canvas = createCanvas({ width: denoised.cols, height: denoised.rows });
    cv.imshow(canvas, denoised);
    return { canvas, inverted };
  } finally {
    rgba.delete();
    gray.delete();
    denoised.delete();
  }
}

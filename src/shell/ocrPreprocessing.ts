import { prepareTextForOcr } from "../core";
import { canvasPixels, grayscaleToCanvas } from "./canvasUtils";

/** A text crop prepared for Tesseract (see prepareTextForOcr): dark text on
 * a light background, denoised, plus whether it had to be inverted. */
export function prepareForOcr(textCanvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; inverted: boolean } {
  const { gray, inverted } = prepareTextForOcr(canvasPixels(textCanvas));
  return { canvas: grayscaleToCanvas(gray), inverted };
}

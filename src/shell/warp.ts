import { warpPerspective } from "../core";
import type { Interpolation, Matrix3x3, RgbaPixelBuffer, Size } from "../core";
import { pixelsToCanvas } from "./canvasUtils";

/** `source` warped by the source→output homography `matrix` onto a new
 * `outputSize` canvas (see warpPerspective). */
export function warpToCanvas(
  source: RgbaPixelBuffer,
  matrix: Matrix3x3,
  outputSize: Size,
  interpolation: Interpolation,
): HTMLCanvasElement {
  return pixelsToCanvas(warpPerspective(source, matrix, outputSize, interpolation));
}

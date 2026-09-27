import type { Matrix3x3, OpenCv, Size } from "../core";
import { createCanvas } from "./canvasUtils";

/** `source` warped by the source→output homography `matrix` onto a new
 * `outputSize` canvas, with bicubic interpolation (the default bilinear
 * softens glyph edges when upsampling). Frees every Mat it allocates. */
export function warpWithMatrix(cv: OpenCv, source: HTMLCanvasElement, matrix: Matrix3x3, outputSize: Size): HTMLCanvasElement {
  const output = createCanvas(outputSize);
  const srcMat = cv.imread(source);
  const warped = new cv.Mat();
  const transformMat = cv.matFromArray(3, 3, cv.CV_64F, matrix.flat());
  try {
    cv.warpPerspective(srcMat, warped, transformMat, new cv.Size(outputSize.width, outputSize.height), cv.INTER_CUBIC);
    cv.imshow(output, warped);
  } finally {
    srcMat.delete();
    warped.delete();
    transformMat.delete();
  }
  return output;
}

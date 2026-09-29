import {
  canonicalCardSizeFor,
  computeOutputRotationDegrees,
  computePerspectiveTransform,
  distance,
} from "../core";
import type { CardOrientation, OpenCv, Quad, Size } from "../core";
import { rotateCanvas } from "./canvasUtils";
import { warpWithMatrix } from "./warp";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";

/**
 * Produces the card image for display and debug: perspective-warps `frame`'s
 * quad into an exactly card-proportioned canvas at the card's native size in
 * the frame, then rotates it upright. OCR doesn't use it — regions are warped
 * straight from the frame (see warpRegion).
 */
export function captureFlattenedCard(cv: OpenCv, frame: AcceptedFrame, cardOrientation: CardOrientation): HTMLCanvasElement {
  const outputSize = flattenedOutputSize(frame.corners);
  const flat = warpQuad(cv, frame.frameCanvas, frame.corners, outputSize);
  const camera = orientationFromSize({ width: frame.frameCanvas.width, height: frame.frameCanvas.height });
  return rotateCanvas(flat, computeOutputRotationDegrees(camera, cardOrientation));
}

/**
 * Warp target size (pre-rotation): the quad's measured side lengths, snapped
 * to the card's exact aspect ratio. The pre-rotation quad may be sideways, so
 * the short/long sides are decided by the measured lengths rather than
 * assuming width is the short side.
 */
function flattenedOutputSize(corners: Quad): Size {
  const [topLeft, topRight, , bottomLeft] = corners;
  const nativeWidth = distance(topLeft, topRight);
  const nativeHeight = distance(topLeft, bottomLeft);
  const widthIsShortSide = nativeWidth <= nativeHeight;

  const canonical = canonicalCardSizeFor({
    width: Math.min(nativeWidth, nativeHeight),
    height: Math.max(nativeWidth, nativeHeight),
  });
  return widthIsShortSide ? canonical : { width: canonical.height, height: canonical.width };
}

/** `cv.warpPerspective` of `corners` in `source` onto a new `outputSize`
 * canvas. */
function warpQuad(cv: OpenCv, source: HTMLCanvasElement, corners: Quad, outputSize: Size): HTMLCanvasElement {
  return warpWithMatrix(cv, source, computePerspectiveTransform(cv, corners, outputSize), outputSize);
}

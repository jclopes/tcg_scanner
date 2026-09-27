import {
  canonicalCardSizeFor,
  computeOutputRotationDegrees,
  computePerspectiveTransform,
  distance,
  FLATTEN_OVERSAMPLE_FACTOR,
} from "../core";
import type { CardPrintFormat, OpenCv, Quad, Size } from "../core";
import { rotateCanvas } from "./canvasUtils";
import { warpWithMatrix } from "./warp";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";

/**
 * Produces the final card image: perspective-warps `frame`'s quad into an
 * oversampled, exactly card-proportioned canvas, then rotates it upright.
 * Used for display and debug; OCR regions are warped straight from the frame
 * (see warpRegion).
 */
export function captureFlattenedCard(cv: OpenCv, frame: AcceptedFrame, cardFormat: CardPrintFormat): HTMLCanvasElement {
  const outputSize = flattenedOutputSize(frame.corners);
  const flat = warpQuad(cv, frame.frameCanvas, frame.corners, outputSize);
  const camera = orientationFromSize({ width: frame.frameCanvas.width, height: frame.frameCanvas.height });
  return rotateCanvas(flat, computeOutputRotationDegrees(camera, cardFormat));
}

/**
 * Warp target size (pre-rotation): the quad's measured side lengths ×
 * FLATTEN_OVERSAMPLE_FACTOR, snapped to the card's exact aspect ratio. The
 * pre-rotation quad may be sideways, so the short/long sides are decided by
 * the measured lengths rather than assuming width is the short side.
 */
function flattenedOutputSize(corners: Quad): Size {
  const [topLeft, topRight, , bottomLeft] = corners;
  const nativeWidth = distance(topLeft, topRight);
  const nativeHeight = distance(topLeft, bottomLeft);
  const widthIsShortSide = nativeWidth <= nativeHeight;

  const canonical = canonicalCardSizeFor({
    width: Math.min(nativeWidth, nativeHeight) * FLATTEN_OVERSAMPLE_FACTOR,
    height: Math.max(nativeWidth, nativeHeight) * FLATTEN_OVERSAMPLE_FACTOR,
  });
  return widthIsShortSide ? canonical : { width: canonical.height, height: canonical.width };
}

/** `cv.warpPerspective` of `corners` in `source` onto a new `outputSize`
 * canvas. */
function warpQuad(cv: OpenCv, source: HTMLCanvasElement, corners: Quad, outputSize: Size): HTMLCanvasElement {
  return warpWithMatrix(cv, source, computePerspectiveTransform(cv, corners, outputSize), outputSize);
}

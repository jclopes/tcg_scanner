import { canonicalCardSizeFor, computeOutputRotationDegrees, computePerspectiveTransform, distance } from "../core";
import type { CardOrientation, Quad, Size } from "../core";
import { rotateCanvas } from "./canvasUtils";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";
import { warpToCanvas } from "./warp";

/**
 * Produces the card image for display and debug: perspective-warps `frame`'s
 * quad into an exactly card-proportioned canvas at the card's native size in
 * the frame (bilinear: it's never read by OCR), then rotates it upright. OCR
 * regions are warped straight from the frame instead (see warpRegion).
 */
export function captureFlattenedCard(frame: AcceptedFrame, cardOrientation: CardOrientation): HTMLCanvasElement {
  const outputSize = flattenedOutputSize(frame.corners);
  const flat = warpToCanvas(frame.pixels, computePerspectiveTransform(frame.corners, outputSize), outputSize, "bilinear");
  return rotateCanvas(flat, computeOutputRotationDegrees(orientationFromSize(frame.pixels), cardOrientation));
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

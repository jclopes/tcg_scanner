import { canonicalCardSizeFor, computeOutputRotationDegrees, computePerspectiveTransform, distance, warpPerspective } from "../core";
import type { CardOrientation, Quad, Size } from "../core";
import { pixelsToCanvas, rotateCanvas } from "./canvasUtils";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";

/** The upright card for display and debug, warped at its size in the frame.
 * Bilinear: OCR reads regions warped straight from the frame instead. */
export function captureFlattenedCard(frame: AcceptedFrame, cardOrientation: CardOrientation): HTMLCanvasElement {
  const outputSize = flattenedOutputSize(frame.corners);
  const flat = pixelsToCanvas(
    warpPerspective(frame.pixels, computePerspectiveTransform(frame.corners, outputSize), outputSize, "bilinear"),
  );
  return rotateCanvas(flat, computeOutputRotationDegrees(orientationFromSize(frame.pixels), cardOrientation));
}

/** Warp size before rotation: the quad's side lengths snapped to the card's
 * aspect ratio, taking short and long from the measurements since the quad
 * may lie sideways. */
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

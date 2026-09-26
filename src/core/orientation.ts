import type { CardPrintFormat, Orientation } from "./types";

/**
 * Clockwise rotation (degrees) that makes the flattened card upright.
 *
 * Matching camera/card orientation → 0. Mismatched → 90: the guide tells the
 * user to place the card's top edge toward the left of the camera's view, so
 * the raw flattened crop's top sits on the left and a 90° clockwise rotation
 * moves it to the top.
 */
export function computeOutputRotationDegrees(
  camera: Orientation,
  card: CardPrintFormat,
): 0 | 90 {
  return camera === card ? 0 : 90;
}

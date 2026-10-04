import type { CardOrientation, Orientation } from "./types";

/** Clockwise rotation that makes the flattened card upright: 90 when the
 * orientations differ, since the guide then asks for the card's top on the
 * left. */
export function computeOutputRotationDegrees(
  camera: Orientation,
  card: CardOrientation,
): 0 | 90 {
  return camera === card ? 0 : 90;
}

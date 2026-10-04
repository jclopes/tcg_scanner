import type { Size, ToleranceConfig } from "../core";

/** Detection tolerances; starting guesses. A hand-held card is rarely
 * rotated more than a few degrees, and perspective skews its measured aspect
 * ratio, so the aspect tolerance is generous. */
export const DEFAULT_TOLERANCE_CONFIG: ToleranceConfig = {
  rotationToleranceDegrees: 8,
  aspectRatioTolerance: 0.1,
};

/** Accepted burst frames to collect before selecting the best one. Starting guess. */
export const CAPTURE_BURST_MIN_USABLE_FRAMES = 2;

/** Max frames attempted in a burst; after that the best of whatever was
 * accepted is used. Starting guess. */
export const CAPTURE_BURST_HARD_LIMIT = 10;

/** The lowest camera resolution the app accepts; a camera that can't reach
 * it isn't offered. */
export const MIN_CAMERA_RESOLUTION: Size = { width: 1920, height: 1080 };

/** The resolutions the camera settings offer, ascending. */
export const CAMERA_RESOLUTION_OPTIONS: readonly { label: string; size: Size }[] = [
  { label: "1920 × 1080 (Full HD)", size: MIN_CAMERA_RESOLUTION },
  { label: "2560 × 1440 (QHD)", size: { width: 2560, height: 1440 } },
  { label: "3840 × 2160 (4K)", size: { width: 3840, height: 2160 } },
];

/** Pre-selected until the user picks another. */
export const DEFAULT_CAMERA_RESOLUTION: Size = MIN_CAMERA_RESOLUTION;

/** The options a camera with this max size can deliver. Throws if there are
 * none: listFullHdCameras only offers cameras that reach Full HD. */
export function resolutionOptionsForCamera(
  maxWidth: number,
  maxHeight: number,
): readonly { label: string; size: Size }[] {
  const supported = CAMERA_RESOLUTION_OPTIONS.filter(
    (option) => option.size.width <= maxWidth && option.size.height <= maxHeight,
  );
  if (supported.length === 0) {
    throw new Error(`No supported resolution for a camera with max ${maxWidth}×${maxHeight}.`);
  }
  return supported;
}

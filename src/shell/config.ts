import type { Size, ToleranceConfig } from "../core";

/**
 * Placeholder detection tolerances for the live scan loop.
 *
 * Per the plan (docs/plan/01-capture-and-detection.md, Open Questions #3)
 * these are explicitly left as tunable parameters that need empirical
 * tuning against real devices/cameras once a first build exists — this is
 * not that tuning pass, just sane, documented defaults so the loop has
 * *something* concrete to run with:
 *
 * - `rotationToleranceDegrees` (8): a hand-held card roughly following the
 *   guide is rarely rotated more than a few degrees relative to it — used by
 *   fitEdgeLine's angle-plausibility filter (see ToleranceConfig's doc
 *   comment).
 * - `aspectRatioTolerance` (0.1): deliberately generous. A well-aligned
 *   card's *measured* aspect ratio is still skewed by ordinary perspective
 *   foreshortening (the card is rarely held perfectly parallel to the
 *   camera's image plane), so a tight tolerance here risks false rejections
 *   more than a loose one risks false accepts — a non-card object happening
 *   to match a ~0.72 aspect ratio within 10% against a generic background is
 *   unlikely.
 *
 * expectedEdgeBands' own band-sizing tolerances used to live here too
 * (`positionTolerance`, `zoomTolerance`) — replaced by fixed pixel margins,
 * EDGE_BAND_HALF_THICKNESS_PX / EDGE_BAND_LENGTH_OVERHANG_PX in
 * src/core/constants.ts.
 */
export const DEFAULT_TOLERANCE_CONFIG: ToleranceConfig = {
  rotationToleranceDegrees: 8,
  aspectRatioTolerance: 0.1,
};

/**
 * Camera resolutions offered by the resolution dropdown (src/shell/app.ts),
 * in ascending order. Detection runs against whichever is selected, not
 * full sensor resolution (per the plan's "Device & resolution handling").
 * The app requires Full HD (1920×1080) or higher — see
 * startCameraStream's doc comment — so no lower option is offered; a device
 * whose camera can't meet even the lowest option here fails to start with a
 * clear error rather than silently falling back to a blurrier feed.
 */
export const CAMERA_RESOLUTION_OPTIONS: readonly { label: string; size: Size }[] = [
  { label: "1920 × 1080 (Full HD)", size: { width: 1920, height: 1080 } },
  { label: "2560 × 1440 (QHD)", size: { width: 2560, height: 1440 } },
  { label: "3840 × 2160 (4K)", size: { width: 3840, height: 2160 } },
];

/** The resolution pre-selected when the app first loads — the minimum this
 * app supports (see CAMERA_RESOLUTION_OPTIONS' doc comment). */
export const DEFAULT_CAMERA_RESOLUTION: Size = CAMERA_RESOLUTION_OPTIONS[0]!.size;

/**
 * Narrows CAMERA_RESOLUTION_OPTIONS down to the ones a specific camera can
 * actually deliver, given its probed max width/height (see
 * listFullHdCameras in cameraDevices.ts) — per the requirement that the
 * resolution dropdown's choices depend on the selected camera, while the
 * Full HD floor still always applies (every CAMERA_RESOLUTION_OPTIONS entry
 * already meets it, and every camera offered by listFullHdCameras already
 * meets it too, so this can never return an empty list).
 */
export function resolutionOptionsForCamera(
  maxWidth: number,
  maxHeight: number,
): readonly { label: string; size: Size }[] {
  const supported = CAMERA_RESOLUTION_OPTIONS.filter(
    (option) => option.size.width <= maxWidth && option.size.height <= maxHeight,
  );
  return supported.length > 0 ? supported : [CAMERA_RESOLUTION_OPTIONS[0]!];
}

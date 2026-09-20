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
 * - `positionTolerance` (0.08): allows the card to be off-center by up to
 *   ~8% of the guide's size. Wide enough for imprecise hand-holding without
 *   widening expectedEdgeBands' bands so far they start overlapping
 *   unrelated background edges.
 * - `rotationToleranceDegrees` (8): a hand-held card roughly following the
 *   guide is rarely rotated more than a few degrees relative to it.
 * - `zoomTolerance` (0.08): allows the card to be held slightly nearer or
 *   farther than an exact guide fill.
 * - `aspectRatioTolerance` (0.1): deliberately more generous than the other
 *   three. A well-aligned card's *measured* aspect ratio is still skewed by
 *   ordinary perspective foreshortening (the card is rarely held perfectly
 *   parallel to the camera's image plane), so a tight tolerance here risks
 *   false rejections more than a loose one risks false accepts — a
 *   non-card object happening to match a ~0.72 aspect ratio within 10%
 *   against a generic background is unlikely.
 */
export const DEFAULT_TOLERANCE_CONFIG: ToleranceConfig = {
  positionTolerance: 0.08,
  rotationToleranceDegrees: 8,
  zoomTolerance: 0.08,
  aspectRatioTolerance: 0.1,
};

/**
 * Preview stream request size. Detection runs against this resolution, not
 * full sensor resolution (per the plan's "Device & resolution handling") —
 * requesting a moderate size up front keeps per-frame Canny/HoughLinesP
 * cost bounded on lower-end devices. The browser is free to pick something
 * smaller if it can't satisfy this exactly; `ideal` (not `exact`/`min`) so
 * camera acquisition never fails purely over resolution.
 */
export const PREVIEW_STREAM_SIZE: Size = { width: 1280, height: 720 };

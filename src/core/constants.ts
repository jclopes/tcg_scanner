// Tunable constants for the functional core. Grouped here (rather than
// inlined) so they're easy to find and retune once real-device empirical
// data is available (see docs/plan/01-capture-and-detection.md, Open
// Questions #3) without hunting through function bodies.

import type { Size } from "./types";

/**
 * Physical trading-card stock dimensions this app targets: 63mm x 88mm
 * (2.5in x 3.5in), per the plan's "Physical card model". Named, not inlined,
 * so a differently-sized card format could be added later without touching
 * detection logic.
 */
export const STANDARD_CARD_WIDTH_MM = 63;
export const STANDARD_CARD_HEIGHT_MM = 88;

/** Short-side : long-side ratio of the standard card (~0.7159). This is the
 * `targetAspectRatio` validateQuad and computeGuideGeometry are meant to be
 * called with for the standard card format. */
export const STANDARD_CARD_ASPECT_RATIO = STANDARD_CARD_WIDTH_MM / STANDARD_CARD_HEIGHT_MM;

/**
 * Fraction of the available frame dimension the guide rectangle fills.
 * Judgment call: the plan asks for the guide to be "sized to fill most of
 * the frame ... with a margin for the user's positioning tolerance" without
 * a number. 0.92 leaves an 8% margin so expectedEdgeBands' bands (which
 * extend outward from the guide edges) still mostly land inside the visible
 * frame instead of being clipped at the frame boundary.
 */
export const GUIDE_FILL_FRACTION = 0.92;

/**
 * The camera frame resolution EDGE_BAND_HALF_THICKNESS_PX /
 * EDGE_BAND_LENGTH_OVERHANG_PX are calibrated at — 1920x1080 (Full HD), this
 * app's minimum/default camera resolution (see CAMERA_RESOLUTION_OPTIONS in
 * src/shell/config.ts). A hand-held card's realistic positioning jitter is
 * a physical-world quantity (roughly constant regardless of resolution),
 * but expressed in *pixels* it scales with however many pixels the camera
 * frame actually has — the same jitter spans twice as many pixels at a
 * frame twice the linear resolution. expectedEdgeBands scales both
 * constants by the camera's actual frame size relative to this reference
 * (see its doc comment), so switching the camera resolution dropdown keeps
 * the same *real-world* tolerance instead of silently becoming tighter (at
 * a higher resolution) or looser (at a lower one) in pixel terms.
 */
export const EDGE_BAND_REFERENCE_FRAME_SIZE: Size = { width: 1920, height: 1080 };

/**
 * expectedEdgeBands' band thickness at EDGE_BAND_REFERENCE_FRAME_SIZE: how
 * many pixels each band extends to *each side* of the guide edge line (i.e.
 * perpendicular to the edge) — the same pixel count on all 4 sides,
 * regardless of guide orientation, before being scaled for the actual
 * camera resolution (see EDGE_BAND_REFERENCE_FRAME_SIZE's doc comment). A
 * fixed pixel value at the reference resolution, not a fraction of the
 * guide's size (an earlier approach — see git history): a search band only
 * needs to be wide enough to cover a hand-held card's realistic positioning
 * jitter, which doesn't scale with the guide's own size the way a fraction
 * implies. 30 is a starting guess, not a measured value — a tuning target
 * once this has been checked against real devices.
 */
export const EDGE_BAND_HALF_THICKNESS_PX = 30;

/**
 * expectedEdgeBands' band length overhang at EDGE_BAND_REFERENCE_FRAME_SIZE:
 * how many pixels each band extends *past* each end of the guide's own edge
 * segment (i.e. parallel to the edge, beyond its corners), on both ends, on
 * all 4 sides, before being scaled for the actual camera resolution (see
 * EDGE_BAND_REFERENCE_FRAME_SIZE's doc comment). Deliberately an overhang
 * rather than an inset (an earlier approach — see git history): a small
 * margin past the nominal corner rather than trimming the band shorter, so
 * a slightly-misaligned card's edge still falls inside its band near the
 * corners instead of being cut off early. 15 is a starting guess, not a
 * measured value — a tuning target once this has been checked against real
 * devices.
 */
export const EDGE_BAND_LENGTH_OVERHANG_PX = 15;

/**
 * fitEdgeLine's fail-fast threshold (0-255 scale): the per-scanline max
 * gradient, averaged across all scanlines in at least one axis (see
 * fastEdgeScore's doc comment in edgeLine.ts for why it's this and not a
 * whole-band mean), a band must exceed before bothering to run
 * Canny/HoughLinesP at all. A band with no edge in it (flat background, or
 * noise below this) is rejected immediately. See plan, "Fail-fast within
 * each worker". 20 comfortably separates single-digit sensor-noise-scale
 * gradients from a real card-edge transition (which approaches 255 for a
 * sharp edge, and stays well above 20 even when most of the band's length is
 * occluded).
 */
export const EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD = 20;

/** Canny thresholds used by fitEdgeLine. Mid-range defaults for 8-bit
 * gradient images; a tuning target once real camera frames are available. */
export const EDGE_CANNY_LOW_THRESHOLD = 50;
export const EDGE_CANNY_HIGH_THRESHOLD = 150;

/** HoughLinesP parameters used by fitEdgeLine. rho/theta are the classic
 * 1px / 1deg accumulator resolution. minLineLength/maxLineGap are expressed
 * as fractions of the band's long axis (its expected-edge-length dimension)
 * rather than absolute pixels, so they scale with band size. */
export const EDGE_HOUGH_RHO = 1;
export const EDGE_HOUGH_THETA = Math.PI / 180;
export const EDGE_HOUGH_VOTE_THRESHOLD = 20;
export const EDGE_HOUGH_MIN_LINE_LENGTH_FRACTION = 0.3;
export const EDGE_HOUGH_MAX_LINE_GAP_FRACTION = 0.05;

/** Minimum fitEdgeLine confidence (see its doc comment for how confidence is
 * derived) below which the fit is treated as "not found" (returns null)
 * rather than as a weak-but-usable line. */
export const EDGE_MIN_CONFIDENCE = 0.25;

/**
 * fitEdgeLine's outward-clustering gap threshold: expressed as a fraction
 * of the band's thickness (its short axis). Segments are sorted by how far
 * "outward" each sits, then walked from the outward-most one inward; a
 * *single step's* gap larger than this stops inclusion, on the assumption
 * that a real further-in feature (e.g. a card's own printed border/artwork
 * frame) is separated from the true edge by a visible gap, whereas
 * fragments of one real edge (including one spread out by rotation) stay
 * close together step to step even if their *total* spread is large. See
 * fitEdgeLine's doc comment. Deliberately a per-step gap, not a total
 * distance from the outward extreme — the latter would wrongly cut off
 * part of a single edge that's legitimately spread across much of the
 * band's thickness by rotation (see rotationToleranceDegrees). A tuning
 * target once real cards/devices are available.
 */
export const EDGE_OUTWARD_GAP_TOLERANCE_FRACTION = 0.1;

/**
 * How many frames to capture per burst attempt — each independently detected
 * and flattened, the same way a single accepted frame is — after a quad is
 * first accepted, in order to pick the single sharpest, best-card-aspect-ratio-matched
 * one as the final output (see `selectBestFrame` in src/core/frameQuality.ts)
 * rather than committing to whichever one frame happened to trigger
 * acceptance. 10 is a starting guess, not a measured value — a tuning
 * target once this has been checked against real devices (more frames
 * costs more capture time per scan, which the user spends holding the card
 * still).
 */
export const CAPTURE_BURST_FRAME_COUNT = 10;

/**
 * Minimum number of successfully captured frames from a burst before the
 * best-frame selection (via `selectBestFrame`) is accepted as the final
 * output. If fewer frames are captured, the burst loop will continue trying
 * (up to CAPTURE_BURST_HARD_LIMIT total frames) to gather at least this many
 * candidates. 5 is a conservative threshold to ensure reasonable frame
 * selection odds — a tuning target once real devices are available.
 */
export const CAPTURE_BURST_MIN_USABLE_FRAMES = 5;

/**
 * Hard limit on total frames captured across all burst attempts before
 * giving up and showing an error (asking the user to try again). If this
 * limit is reached and fewer than CAPTURE_BURST_MIN_USABLE_FRAMES frames
 * were captured, the process restarts. 30 is 3x the initial per-attempt
 * budget (CAPTURE_BURST_FRAME_COUNT × 3), balancing user patience against
 * ensuring reasonable odds of success — a tuning target.
 */
export const CAPTURE_BURST_HARD_LIMIT = 30;

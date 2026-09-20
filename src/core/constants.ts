// Tunable constants for the functional core. Grouped here (rather than
// inlined) so they're easy to find and retune once real-device empirical
// data is available (see docs/plan/01-capture-and-detection.md, Open
// Questions #3) without hunting through function bodies.

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
 * a number. 0.92 leaves an 8% margin so expectedEdgeBands' tolerance bands
 * (which extend outward from the guide edges) still mostly land inside the
 * visible frame instead of being clipped at the frame boundary.
 */
export const GUIDE_FILL_FRACTION = 0.92;

/**
 * Fraction of each edge band's length trimmed off both ends, to keep the
 * sampled band away from the card's rounded corners (where a straight-line
 * fit is unreliable — see plan, "Detection strategy"). 0.12 per end (24%
 * of the edge trimmed in total) comfortably clears a standard playing-card
 * corner radius (~3mm on an 88mm long edge, i.e. ~3.4%) with headroom for
 * guide/card misalignment.
 */
export const EDGE_BAND_CORNER_INSET_FRACTION = 0.12;

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

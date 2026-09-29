// Tunable constants for the functional core. Values marked "starting guess"
// are tuning targets once real-device data is available.

import type { Size } from "./types";

/** Standard trading-card stock: 63mm x 88mm. */
export const STANDARD_CARD_WIDTH_MM = 63;
export const STANDARD_CARD_HEIGHT_MM = 88;

/** Short side : long side (~0.7159). */
export const STANDARD_CARD_ASPECT_RATIO = STANDARD_CARD_WIDTH_MM / STANDARD_CARD_HEIGHT_MM;

/** Minimum resolution `canonicalCardSizeFor` will produce — only reached by a
 * degenerate, tiny quad. */
export const CANONICAL_CARD_MIN_PX_PER_MM = 15;

/** Fraction of the frame the guide fills, leaving room for the edge bands to
 * extend outward without being clipped. */
export const GUIDE_FILL_FRACTION = 0.92;

/** Resolution the edge-band pixel sizes below are calibrated for; bands are
 * scaled to the actual frame size so the real-world tolerance stays constant
 * across camera resolutions. */
export const EDGE_BAND_REFERENCE_FRAME_SIZE: Size = { width: 1920, height: 1080 };

/** Band half-thickness (px at the reference size) on each side of a guide
 * edge — covers hand-held positioning jitter. Starting guess. */
export const EDGE_BAND_HALF_THICKNESS_PX = 30;

/** How far (px at the reference size) each band extends past both ends of its
 * guide edge, so a slightly misaligned card's edge isn't cut off near the
 * corners. Starting guess. */
export const EDGE_BAND_LENGTH_OVERHANG_PX = 15;

/** `fitEdgeLine` fail-fast threshold (0-255) on its per-scanline max gradient
 * score: separates sensor noise from a real card edge. */
export const EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD = 20;

/** Canny thresholds used by `fitEdgeLine`. */
export const EDGE_CANNY_LOW_THRESHOLD = 50;
export const EDGE_CANNY_HIGH_THRESHOLD = 150;

/** HoughLinesP parameters used by `fitEdgeLine`. Line length/gap are fractions
 * of the band's long axis. */
export const EDGE_HOUGH_RHO = 1;
export const EDGE_HOUGH_THETA = Math.PI / 180;
export const EDGE_HOUGH_VOTE_THRESHOLD = 20;
export const EDGE_HOUGH_MIN_LINE_LENGTH_FRACTION = 0.3;
export const EDGE_HOUGH_MAX_LINE_GAP_FRACTION = 0.05;

/** `fitEdgeLine` confidence below which a fit counts as "not found". */
export const EDGE_MIN_CONFIDENCE = 0.25;

/** Max per-step gap, as a fraction of band thickness, between consecutive
 * segments (sorted outward → inward) for them to count as one edge. */
export const EDGE_OUTWARD_GAP_TOLERANCE_FRACTION = 0.1;

/** Accepted burst frames to collect before selecting the best one. Starting guess. */
export const CAPTURE_BURST_MIN_USABLE_FRAMES = 2;

/** Largest edit distance between the OCR'd collector number and a set's
 * card ID that still counts as a confident identification; anything worse
 * (or no OCR text at all) restarts detection. */
export const MAX_CONFIDENT_MATCH_DISTANCE = 2;

/** Max frames attempted across all bursts; after that the best of whatever
 * was accepted is used. Starting guess. */
export const CAPTURE_BURST_HARD_LIMIT = 10;

/** Pixel density text/image regions are warped to — the character size
 * Tesseract's `eng` model reads best (found by sweeping real captures; both
 * larger and smaller read worse). */
export const REGION_PX_PER_MM = 26;

/** Padding added around each text region's configured box to form its search
 * area: above/below (Y) and left/right (X). Starting guesses. */
export const TEXT_SEARCH_PADDING_Y_MM = 1.0;
export const TEXT_SEARCH_PADDING_X_MM = 1.5;

/** How many times the median (background) row's glyph-stroke energy the
 * strongest row must reach for a search area to count as containing text.
 * Relative, since real crops' absolute gradients are low. Starting guess. */
export const TEXT_BAND_MIN_PEAK_TO_BACKGROUND = 2.5;

/** A row edge counts as a horizontal line (e.g. a badge border) when its
 * vertical-gradient energy is at least this many times the median row's.
 * Starting guess (3 missed a real badge border). */
export const HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND = 2.5;

/** Rows whose gradient energy is above this fraction of the way from the
 * profile's min to its max belong to the text band. Starting guess. */
export const TEXT_BAND_ENERGY_THRESHOLD_FRACTION = 0.3;

/** Margin kept above and below the detected text band, as a fraction of the
 * band's height. Starting guess. */
export const TEXT_BAND_MARGIN_FRACTION = 0.15;

/** Columns whose stroke energy (within the text rows) is above this fraction
 * of the reference column's (see TEXT_COLUMN_REFERENCE_PERCENTILE) count as
 * text. Starting guess. */
export const TEXT_COLUMN_ENERGY_THRESHOLD_FRACTION = 0.5;

/** Percentile of the column profile used as the reference level, rather than
 * its max: a narrow, very strong feature (e.g. the card's edge against the
 * background) covering under 10% of the width can't raise the threshold
 * above the text. Starting guess. */
export const TEXT_COLUMN_REFERENCE_PERCENTILE = 0.9;

/** Default for a text region's `maxGapTextHeights`: runs of text columns
 * separated by at most this many text heights belong to the same line.
 * Generous, to cover word gaps (e.g. around the "·" in a set code, measured up
 * to ~1.2 text heights); single-word regions should set a tighter value in
 * their config. Starting guess. */
export const DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS = 1.5;

/** Margin kept left and right of the text columns, in text heights. Starting guess. */
export const TEXT_COLUMN_MARGIN_TEXT_HEIGHTS = 0.3;

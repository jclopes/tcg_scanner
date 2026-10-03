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

/** `fitEdgeLine`: the smallest Sobel gradient across a scanline that counts
 * as an edge point — the high threshold the Canny detector used before. A
 * clean step of d gray levels scores 4·d, so this is a step of ~38; sensor
 * noise and faint background texture score lower. */
export const EDGE_POINT_MIN_GRADIENT = 150;

/** `fitEdgeLine`: a candidate line must have edge points on at least this
 * fraction of the scanlines where it lies inside the band. Starting guess. */
export const EDGE_LINE_MIN_SUPPORT_FRACTION = 0.3;

/** `fitEdgeLine`: edge points within this distance of the chosen line are
 * fitted. Starting guess. */
export const EDGE_INLIER_DISTANCE_PX = 1.5;

/** `fitEdgeLine` confidence below which a fit counts as "not found". */
export const EDGE_MIN_CONFIDENCE = 0.25;

/** Accepted burst frames to collect before selecting the best one. Starting guess. */
export const CAPTURE_BURST_MIN_USABLE_FRAMES = 2;

/** Largest edit distance between the OCR'd collector number and a set's
 * card ID that still counts as a confident identification; anything worse
 * (or no OCR text at all) restarts detection. */
export const MAX_CONFIDENT_MATCH_DISTANCE = 2;

/** Max frames attempted across all bursts; after that the best of whatever
 * was accepted is used. Starting guess. */
export const CAPTURE_BURST_HARD_LIMIT = 10;

/** Bilateral denoise applied to text crops before OCR: a 5×5 neighborhood
 * (radius 2) with color and space sigma 50. Edge-preserving smoothing that, in
 * testing against real captures, read as well as a 1.5× denser warp at a
 * fraction of the cost (binarization, sharpening, median and higher densities
 * were compared and dropped). */
export const OCR_DENOISE_RADIUS_PX = 2;
export const OCR_DENOISE_SIGMA_COLOR = 50;
export const OCR_DENOISE_SIGMA_SPACE = 50;

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

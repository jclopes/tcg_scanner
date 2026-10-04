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
 * as an edge point. A clean step of d gray levels scores 4·d, so this is a
 * step of ~38: above sensor noise and faint background texture. */
export const EDGE_POINT_MIN_GRADIENT = 150;

/** `fitEdgeLine`: a candidate line must have edge points on at least this
 * fraction of the scanlines where it lies inside the band. Starting guess. */
export const EDGE_LINE_MIN_SUPPORT_FRACTION = 0.3;

/** `fitEdgeLine`: edge points within this distance of the chosen line are
 * fitted. Starting guess. */
export const EDGE_INLIER_DISTANCE_PX = 1.5;

/** `fitEdgeLine` confidence below which a fit counts as "not found". */
export const EDGE_MIN_CONFIDENCE = 0.25;

/** Largest edit distance between the OCR'd collector number and a set's
 * card ID that still counts as a confident identification; anything worse
 * (or no OCR text at all) restarts detection. */
export const MAX_CONFIDENT_MATCH_DISTANCE = 2;

/** Bilateral denoise for text crops before OCR (5×5, sigmas 50): on real
 * captures it read as well as a 1.5× denser warp, at a fraction of the cost. */
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

/** Percentile of the column profile used as the reference level instead of
 * its max, so a narrow strong feature (e.g. the card's edge) can't raise the
 * threshold above the text. Starting guess. */
export const TEXT_COLUMN_REFERENCE_PERCENTILE = 0.9;

/** A text region's default `maxGapTextHeights`: generous enough for word gaps
 * (the "·" in a set code measured up to ~1.2 text heights); single-word
 * regions set a tighter one. Starting guess. */
export const DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS = 1.5;

/** Margin kept left and right of the text columns, in text heights. Starting guess. */
export const TEXT_COLUMN_MARGIN_TEXT_HEIGHTS = 0.3;

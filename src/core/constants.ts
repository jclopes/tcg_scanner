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

/** Largest edit distance between the OCR'd collector number and the best
 * match's card ID that still auto-accepts it, skipping the user's tap —
 * stricter than MAX_CONFIDENT_MATCH_DISTANCE, since auto-accepting is a
 * stronger claim than just showing the match as an option. */
export const AUTO_ACCEPT_MAX_DISTANCE = 1;

/** Smallest OCR confidence (0-100, see `minConfidence`) that still
 * auto-accepts the best match alongside AUTO_ACCEPT_MAX_DISTANCE. */
export const AUTO_ACCEPT_MIN_CONFIDENCE = 98;

/** Bilateral denoise for text crops before OCR (5×5, sigmas 50): on real
 * captures it read as well as a 1.5× denser warp, at a fraction of the cost. */
export const OCR_DENOISE_RADIUS_PX = 2;
export const OCR_DENOISE_SIGMA_COLOR = 50;
export const OCR_DENOISE_SIGMA_SPACE = 50;

/** Pixel density text/image regions are warped to — the character size
 * Tesseract's `eng` model reads best (found by sweeping real captures; both
 * larger and smaller read worse). */
export const REGION_PX_PER_MM = 26;

/** Padding added left and right of each text region's configured box to form
 * its search area. Starting guess. */
export const TEXT_SEARCH_PADDING_X_MM = 1.5;

/** A text region's default `searchPaddingYMm`: padding added above and below
 * its box. Starting guess. */
export const DEFAULT_TEXT_SEARCH_PADDING_Y_MM = 1.0;

/** How many times the median (background) row's glyph-stroke energy the
 * strongest row must reach for a search area to count as containing
 * *something*. Deliberately loose: a row peak alone can't tell real text from
 * a single decorative feature, so TEXT_MIN_SPIKES is the real confidence
 * check, done on its columns (see fitCropToText). Relative, since real crops'
 * absolute gradients are low. Starting guess. */
export const TEXT_BAND_MIN_PEAK_TO_BACKGROUND = 2.0;

/** A detected band's columns must resolve to at least this many comparable
 * spikes (see spikeCount) before `fitCropToText` trusts the crop — a single
 * decorative feature (e.g. a watermark) won't pass; every game's text regions
 * hold at least 2 characters. */
export const TEXT_MIN_SPIKES = 2;

/** A row edge counts as a horizontal line (e.g. a badge border) when its
 * vertical-gradient energy is at least this many times the median row's.
 * Starting guess (3 missed a real badge border). */
export const HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND = 2.5;

/** How much a column's brightness-sum profile (see `columnBrightnessProfile`)
 * contributes to its stroke energy, relative to the gradient-based measure —
 * a glyph is both an edge (gradient) and a departure from its surroundings'
 * color (brightness-sum); weighted down since the two aren't the same units
 * and the sum, scaling with the text band's height, is otherwise far larger.
 * Starting guess. */
export const TEXT_COLUMN_BRIGHTNESS_WEIGHT = 0.05;

/** Rows whose gradient energy is above this fraction of the way from the
 * profile's min to its max belong to the text band. Starting guess. */
export const TEXT_BAND_ENERGY_THRESHOLD_FRACTION = 0.25;

/** Margin kept above and below the detected text band, as a fraction of the
 * band's height. Starting guess. */
export const TEXT_BAND_MARGIN_FRACTION = 0.15;

/** Columns whose stroke energy clears this fraction of the way from the
 * profile's own deepest dip (the best estimate of true background in this
 * particular capture) up to the reference column (see
 * TEXT_COLUMN_REFERENCE_PERCENTILE) count as text. Anchoring to the deepest
 * dip rather than a flat fraction of the reference column lets a genuinely
 * weaker character (e.g. a glyph OCR struggles with) still register as its
 * own run instead of needing to compete with the strongest characters'
 * peak. Starting guess. */
export const TEXT_COLUMN_BACKGROUND_THRESHOLD_FRACTION = 0.25;

/** Percentile of the column profile used as the reference level instead of
 * its max, so a narrow strong feature (e.g. the card's edge) can't raise the
 * threshold above the text. Starting guess. */
export const TEXT_COLUMN_REFERENCE_PERCENTILE = 0.9;

/** A run counts toward its group's spike count (see analyzeTextColumns) only
 * if its energy is at least this fraction of the group's strongest run's —
 * character strokes read within a narrow band of each other, while a solid
 * decorative feature's incidental edge noise reads far weaker than its own
 * bulk. Starting guess. */
export const TEXT_RUN_SIGNIFICANCE_FRACTION = 0.5;

/** A text region's default `extractRegex`: the whole OCR text is its value. */
export const DEFAULT_TEXT_EXTRACT_REGEX = ".*";

/** Columns within this many text heights of either edge of the search area
 * are excluded when picking the reference column `analyzeTextColumns` judges
 * spikes against — a climb that hasn't turned over within view by the edge
 * (e.g. glare or vignetting) would otherwise set the scale every real
 * character is judged against. Starting guess. */
export const TEXT_COLUMN_EDGE_MARGIN_TEXT_HEIGHTS = 0.25;

/** A column counts as a significant spike (the text's own left/right edge)
 * once its stroke+brightness energy reaches this fraction of the reference
 * column's (see TEXT_COLUMN_EDGE_MARGIN_TEXT_HEIGHTS) — almost as strong as
 * the strongest real character, so a column search starting from each edge
 * doesn't stop at mere background texture. Starting guess. */
export const TEXT_COLUMN_SPIKE_FRACTION = 0.4;

/** A column only counts as a spike (see TEXT_COLUMN_SPIKE_FRACTION) if it
 * also rose by at least this fraction of the reference column's energy from
 * the lowest point seen since the edge of the search area — confirming a
 * real dip or decay came before it, rather than the edge already starting
 * high. Starting guess. */
export const TEXT_COLUMN_SPIKE_RISE_FRACTION = 0.2;

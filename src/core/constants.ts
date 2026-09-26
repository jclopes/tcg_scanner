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

/**
 * How much larger (linearly) than the quad's native size `captureFlattenedCard`
 * asks `warpPerspective` to render. Oversampling inside the warp is a single
 * interpolation from the original frame, so it preserves more detail for OCR
 * than upscaling after flattening or cropping. 5 is the density region OCR
 * needs; it runs once per capture, not per frame.
 */
export const FLATTEN_OVERSAMPLE_FACTOR = 5;

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

/** Frames attempted per burst after the preview frame is accepted. Starting guess. */
export const CAPTURE_BURST_FRAME_COUNT = 10;

/** Accepted burst frames to collect before selecting the best one. Starting guess. */
export const CAPTURE_BURST_MIN_USABLE_FRAMES = 5;

/** Max frames attempted across all bursts; after that the best of whatever
 * was accepted is used. Starting guess. */
export const CAPTURE_BURST_HARD_LIMIT = 30;

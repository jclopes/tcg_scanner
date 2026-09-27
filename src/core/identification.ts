// Phase 2 functional core: pure region-geometry and OCR-text-filtering
// helpers. See docs/plan/06-card-identification.md ("Region config format",
// "Architecture: functional core / imperative shell") for the authoritative
// spec these implement.

import { CANONICAL_CARD_MIN_PX_PER_MM, STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import type { Size } from "./types";

/** `"text"` regions are OCR'd and matched against a game's ID dataset;
 * `"image"` regions are extracted but not OCR'd this phase (see the plan's
 * Open Questions). */
export type RegionType = "text" | "image";

/** The box every region has — the parsed, camelCase form of a region config
 * JSON entry (see GameConfig). `xMm`/`yMm`/`widthMm`/`heightMm` are mm
 * coordinates (origin at the top-left corner) on the upright card *after*
 * rotating the whole card clockwise by `rotationDeg` into its bounding box —
 * so a tilted element (e.g. a 45° badge) gets a tight, upright box. A config
 * author measures a rotated region's box on a reference card image rotated
 * by the same angle. See regionWarpMatrix. */
interface RegionBox {
  label: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Clockwise degrees the whole card is rotated by to make this region's
   * content upright; 0/omitted = already upright. */
  rotationDeg?: number;
}

export interface TextRegionConfig extends RegionBox {
  type: "text";
  /** A regex character class (e.g. `"[0-9]"`) constraining OCR output — see
   * `filterAllowedChars`. */
  allowedCharsRegex: string;
  /** The largest gap between runs of characters, in text heights, still
   * counted as the same line (see analyzeTextColumns). Tight for a single
   * word, wider for text with spaces. Omitted =
   * DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS. */
  maxGapTextHeights?: number;
}

export interface ImageRegionConfig extends RegionBox {
  type: "image";
}

/** One named region of a game's card layout. */
export type RegionConfig = TextRegionConfig | ImageRegionConfig;

export interface GameConfig {
  game: string;
  regions: RegionConfig[];
}

/**
 * An exactly card-proportioned pixel size (STANDARD_CARD_WIDTH_MM :
 * STANDARD_CARD_HEIGHT_MM) that is never lower-resolution than
 * `sourcePixelSize` on either axis: it uses the larger of the two axes'
 * implied px-per-mm, floored at CANONICAL_CARD_MIN_PX_PER_MM.
 */
export function canonicalCardSizeFor(sourcePixelSize: Size): Size {
  const impliedPxPerMmX = sourcePixelSize.width / STANDARD_CARD_WIDTH_MM;
  const impliedPxPerMmY = sourcePixelSize.height / STANDARD_CARD_HEIGHT_MM;
  const pxPerMm = Math.max(CANONICAL_CARD_MIN_PX_PER_MM, impliedPxPerMmX, impliedPxPerMmY);
  return {
    width: Math.round(STANDARD_CARD_WIDTH_MM * pxPerMm),
    height: Math.round(STANDARD_CARD_HEIGHT_MM * pxPerMm),
  };
}

/** `region` with `padding.xMm` added left and right of its box and
 * `padding.yMm` above and below — turns a text region's configured box into
 * the area searched for its text. Works for rotated regions too, since their
 * box is already in the rotated frame. */
export function padRegion<T extends RegionConfig>(region: T, padding: { xMm: number; yMm: number }): T {
  return {
    ...region,
    xMm: region.xMm - padding.xMm,
    yMm: region.yMm - padding.yMm,
    widthMm: region.widthMm + 2 * padding.xMm,
    heightMm: region.heightMm + 2 * padding.yMm,
  };
}

/** Keeps only the characters of `raw` matching `allowedCharsRegex` (a
 * single-character class, e.g. `"[0-9]"`), in order. */
export function filterAllowedChars(raw: string, allowedCharsRegex: string): string {
  const matches = raw.match(new RegExp(allowedCharsRegex, "g"));
  return matches ? matches.join("") : "";
}

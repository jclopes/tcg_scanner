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

/** One named region of a game's card layout — the parsed, camelCase form of
 * a region config JSON entry (see GameConfig). `xMm`/`yMm`/`widthMm`/
 * `heightMm` are mm coordinates (origin at the top-left corner) on the
 * upright card *after* rotating the whole card clockwise by `rotationDeg`
 * into its bounding box — so a tilted element (e.g. a 45° badge) gets a
 * tight, upright box. A config author measures a rotated region's box on a
 * reference card image rotated by the same angle. See regionWarpMatrix. */
export interface RegionConfig {
  label: string;
  type: RegionType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Clockwise degrees the whole card is rotated by to make this region's
   * content upright; 0/omitted = already upright. */
  rotationDeg?: number;
  /** Required in practice for `type: "text"` regions (not enforced by this
   * type — see loadGameConfig, the imperative shell's JSON parser, for
   * where that's validated): a regex character class (e.g. `"[0-9]"`)
   * constraining OCR output — see `filterAllowedChars`. */
  allowedCharsRegex?: string;
  /** Text regions only: the largest gap between runs of characters, in text
   * heights, still counted as the same line (see analyzeTextColumns). Tight
   * for a single word, wider for text with spaces. Omitted =
   * DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS. */
  maxGapTextHeights?: number;
}

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
export function padRegion(region: RegionConfig, padding: { xMm: number; yMm: number }): RegionConfig {
  return {
    ...region,
    xMm: region.xMm - padding.xMm,
    yMm: region.yMm - padding.yMm,
    widthMm: region.widthMm + 2 * padding.xMm,
    heightMm: region.heightMm + 2 * padding.yMm,
  };
}

/**
 * Keeps only the characters of `raw` that match `allowedCharsRegex` — a
 * single-character regex class (e.g. `"[0-9]"`, `"[A-Za-z0-9\\-\\[\\] ]"`),
 * per the plan's `allowed_chars_regex` field — discarding everything else,
 * in order. Post-processing, applied to Tesseract's already-recognized
 * text — this same regex is *also* used to constrain recognition itself,
 * as a Tesseract whitelist (see `tesseractWhitelistFor`, src/shell/ocr.ts),
 * which this function's result doesn't depend on or replace — see the
 * plan's "OCR strategy" for why both run.
 *
 * Implemented as "match every single character the pattern accepts, then
 * rejoin" rather than a `replace`-based strip, so `allowedCharsRegex` only
 * ever needs to describe what's *allowed* (a plain character class) — the
 * caller never has to also write its own negation.
 */
export function filterAllowedChars(raw: string, allowedCharsRegex: string): string {
  const matches = raw.match(new RegExp(allowedCharsRegex, "g"));
  return matches ? matches.join("") : "";
}

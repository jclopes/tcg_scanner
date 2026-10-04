import { CANONICAL_CARD_MIN_PX_PER_MM, STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import type { CardOrientation, Size } from "./types";

/** A region's box, in mm from the top-left of the upright card after the
 * whole card is rotated clockwise by `rotationDeg` into its bounding box, so a
 * tilted element (e.g. a 45° badge) gets a tight upright box. */
interface RegionBox {
  label: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Clockwise degrees the whole card is rotated by to make this region's
   * content upright; 0 when it already is. */
  rotationDeg: number;
}

export interface TextRegionConfig extends RegionBox {
  type: "text";
  /** A regex character class (e.g. `"[0-9]"`) constraining OCR output — see
   * `filterAllowedChars`. */
  allowedCharsRegex: string;
  /** The largest gap between runs of characters, in text heights, still
   * counted as the same line (see analyzeTextColumns). Tight for a single
   * word, wider for text with spaces. */
  maxGapTextHeights: number;
}

/** A region that's extracted (shown in the debug trail) but not OCR'd. */
export interface ImageRegionConfig extends RegionBox {
  type: "image";
}

/** One named region of a game's card layout. */
export type RegionConfig = TextRegionConfig | ImageRegionConfig;

export interface GameConfig {
  /** The game's folder id, for messages. */
  game: string;
  /** The card layout per orientation the game's cards are printed in — a
   * landscape card has its regions in different places than a portrait one. */
  regions: Partial<Record<CardOrientation, RegionConfig[]>>;
}

/** `config`'s regions for cards printed in `orientation`. Throws if the game
 * has no such orientation. */
export function regionsFor(config: GameConfig, orientation: CardOrientation): RegionConfig[] {
  const regions = config.regions[orientation];
  if (!regions) {
    throw new Error(`Game "${config.game}" has no regions for ${orientation} cards.`);
  }
  return regions;
}

/** A card-proportioned pixel size never lower-resolution than
 * `sourcePixelSize` on either axis, at least CANONICAL_CARD_MIN_PX_PER_MM. */
export function canonicalCardSizeFor(sourcePixelSize: Size): Size {
  const impliedPxPerMmX = sourcePixelSize.width / STANDARD_CARD_WIDTH_MM;
  const impliedPxPerMmY = sourcePixelSize.height / STANDARD_CARD_HEIGHT_MM;
  const pxPerMm = Math.max(CANONICAL_CARD_MIN_PX_PER_MM, impliedPxPerMmX, impliedPxPerMmY);
  return {
    width: Math.round(STANDARD_CARD_WIDTH_MM * pxPerMm),
    height: Math.round(STANDARD_CARD_HEIGHT_MM * pxPerMm),
  };
}

/** `region` grown by `padding` on each side: a text region's search area. */
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

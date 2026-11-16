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
  /** The characters OCR may read (e.g. `"0123456789"`) — see
   * `filterAllowedChars`. */
  allowedChars: string;
  /** The part of the filtered OCR text that is the region's value: its first
   * match (see `extractMatch`), e.g. `"^[^/]+"` keeps "001" of "001/298". */
  extractRegex: string;
  /** Padding above and below the box that forms its search area (see
   * padRegion). Tight when another text line sits just above or below, which
   * the text-row search would otherwise pick instead. */
  searchPaddingYMm: number;
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

/** One recognized character together with the OCR engine's confidence in it
 * (0-100) — carried through filtering and extraction so a region's final
 * value keeps exactly the confidences of the characters still in it, not a
 * score over the whole raw reading (which may include characters later
 * discarded). `confidence` is `null` for a character that wasn't itself OCR'd
 * (e.g. a space inferred from word boundaries) — `minConfidence` skips it
 * rather than treating "not applicable" as "maximally confident". */
export interface ScoredChar {
  char: string;
  confidence: number | null;
}

/** `chars`' characters joined back into a plain string. */
export function joinScoredChars(chars: readonly ScoredChar[]): string {
  return chars.map((c) => c.char).join("");
}

/** The weakest OCR'd character's confidence in `chars` (characters with no
 * confidence, e.g. inferred spaces, don't count) — not a mean, since one
 * weak character should doom the whole read rather than be diluted by its
 * stronger neighbors. 0 when empty or nothing in it was actually OCR'd. */
export function minConfidence(chars: readonly ScoredChar[]): number {
  const confidences = chars.map((c) => c.confidence).filter((c) => c !== null);
  return confidences.length === 0 ? 0 : Math.min(...confidences);
}

/** Keeps only the characters of `raw` that are in `allowedChars`, in order. */
export function filterAllowedChars(raw: readonly ScoredChar[], allowedChars: string): ScoredChar[] {
  return raw.filter(({ char }) => allowedChars.includes(char));
}

/** The first match of `extractRegex` against `raw`'s joined text, as the
 * corresponding slice of `raw` — empty when there is none. */
export function extractMatch(raw: readonly ScoredChar[], extractRegex: string): ScoredChar[] {
  const match = joinScoredChars(raw).match(new RegExp(extractRegex));
  return match && match.index !== undefined ? raw.slice(match.index, match.index + match[0].length) : [];
}

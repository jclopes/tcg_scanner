// Phase 2 functional core: pure region-geometry and OCR-text-filtering
// helpers. See docs/plan/06-card-identification.md ("Region config format",
// "Architecture: functional core / imperative shell") for the authoritative
// spec these implement.

import { STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import type { Point, Size } from "./types";

/** `"text"` regions are OCR'd and matched against a game's ID dataset;
 * `"image"` regions are extracted but not OCR'd this phase (see the plan's
 * Open Questions). */
export type RegionType = "text" | "image";

/** One named region of a game's card layout — the parsed, camelCase form of
 * a region config JSON entry (see GameConfig). `xMm`/`yMm`/`widthMm`/
 * `heightMm` are mm coordinates (origin at the top-left corner) on the
 * card *as it looks after* `rotationDeg`'s rotation is applied — for an
 * unrotated region (0/unset) that's just the flattened card itself; for a
 * rotated one, it's coordinates on the *whole card rotated by that many
 * degrees*, not on the original flattened output (see cropRegion in
 * src/shell/regionExtraction.ts, which does exactly that rotation before
 * cropping, and its doc comment for why). A config author measures a
 * rotated region's box by rotating a reference card image by the same
 * angle first and measuring directly on that. */
export interface RegionConfig {
  label: string;
  type: RegionType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Clockwise degrees to rotate the *whole card* by, before cropping this
   * region out of it, to undo the region's printed tilt and leave its
   * content upright; 0/omitted = already upright, crop straight from the
   * flattened card. See the plan's `rotation_deg` doc comment for the sign
   * convention and why it's clockwise-positive here despite the config
   * field itself being documented as counter-clockwise-positive (this is
   * the *correction* angle, which is the config value unchanged — see the
   * plan). */
  rotationDeg?: number;
  /** Required in practice for `type: "text"` regions (not enforced by this
   * type — see loadGameConfig, the imperative shell's JSON parser, for
   * where that's validated): a regex character class (e.g. `"[0-9]"`)
   * constraining OCR output — see `filterAllowedChars`. */
  allowedCharsRegex?: string;
}

export interface GameConfig {
  game: string;
  regions: RegionConfig[];
}

/** A `RegionConfig` translated into pixel coordinates against a specific
 * flattened card image's actual pixel dimensions — everything an imperative
 * crop step needs, with no further mm math required. */
export interface PixelRegion {
  label: string;
  type: RegionType;
  /** Axis-aligned, in pixel coordinates on the card *as it looks after*
   * `rotationDeg`'s rotation — i.e. the same card-rotated-by-rotationDeg
   * frame `RegionConfig`'s doc comment describes, just in pixels instead of
   * mm. Not coordinates on the original flattened card for a rotated
   * region (see cropRegion, src/shell/regionExtraction.ts, the imperative
   * step that actually performs that rotation before using this rect). */
  rect: { origin: Point; size: Size };
  rotationDeg?: number;
  allowedCharsRegex?: string;
}

/**
 * Converts each of `regions`' mm measurements into pixels, using the
 * px-per-mm scale implied by `cardPixelSize` — the flattened output
 * image's own pixel dimensions, which (per the plan's "Physical card
 * model") represent exactly the standard 63mm × 88mm card area — producing
 * one `PixelRegion` per input region, in the same order.
 *
 * `cardPixelSize` is used only to derive that resolution (pixels per
 * physical mm), not as "the canvas `rect` is positioned within" — that
 * scale is the same whether or not the region is later rotated (rotating a
 * canvas changes its dimensions, not how many pixels represent one mm), so
 * this same math is correct for both. What it does *not* do is know
 * anything about rotation beyond passing `rotationDeg` through unchanged:
 * for a rotated region, the resulting `rect` is positioned in the
 * card-rotated-by-rotationDeg frame RegionConfig's doc comment describes,
 * not the original flattened card — see cropRegion
 * (src/shell/regionExtraction.ts), the imperative step that actually
 * performs that rotation before using this rect, for the rest of that
 * story. Also doesn't clamp a region that extends past its frame's bounds
 * (also cropRegion's job, same as `extractGrayscaleRegion` clamping edge
 * bands in Phase 1 — see EdgeBandPixels' doc comment in types.ts).
 */
export function computeRegionPixelRects(regions: readonly RegionConfig[], cardPixelSize: Size): PixelRegion[] {
  const pxPerMmX = cardPixelSize.width / STANDARD_CARD_WIDTH_MM;
  const pxPerMmY = cardPixelSize.height / STANDARD_CARD_HEIGHT_MM;

  return regions.map((region) => ({
    label: region.label,
    type: region.type,
    rect: {
      origin: { x: region.xMm * pxPerMmX, y: region.yMm * pxPerMmY },
      size: { width: region.widthMm * pxPerMmX, height: region.heightMm * pxPerMmY },
    },
    rotationDeg: region.rotationDeg,
    allowedCharsRegex: region.allowedCharsRegex,
  }));
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

import { describe, expect, it } from "vitest";
import { CANONICAL_CARD_MIN_PX_PER_MM, STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import { canonicalCardSizeFor, computeRegionPixelRects, filterAllowedChars } from "./identification";
import type { RegionConfig } from "./identification";

describe("canonicalCardSizeFor", () => {
  it("floors a low-resolution source up to CANONICAL_CARD_MIN_PX_PER_MM, exactly on-ratio", () => {
    const result = canonicalCardSizeFor({ width: 100, height: 100 });
    expect(result).toEqual({
      width: STANDARD_CARD_WIDTH_MM * CANONICAL_CARD_MIN_PX_PER_MM,
      height: STANDARD_CARD_HEIGHT_MM * CANONICAL_CARD_MIN_PX_PER_MM,
    });
  });

  it("scales up to a higher-resolution source's own implied px/mm, never down", () => {
    // A source well above the floor in both axes, exactly on-ratio at 20px/mm.
    const result = canonicalCardSizeFor({ width: 63 * 20, height: 88 * 20 });
    expect(result).toEqual({ width: 63 * 20, height: 88 * 20 });
  });

  it("uses the higher of the two axes' implied px/mm when the source is off-ratio, not an average", () => {
    // width implies 20px/mm, height implies only 10px/mm (below the source's
    // own width-implied scale, and below the floor) — the result must still
    // be at least 20px/mm in both dimensions, or the width axis would lose
    // resolution relative to what the source actually had.
    const result = canonicalCardSizeFor({ width: 63 * 20, height: 88 * 10 });
    expect(result.width).toBeGreaterThanOrEqual(63 * 20);
    expect(result.height).toBeGreaterThanOrEqual(88 * 20);
    // Still exactly on-ratio.
    expect(result.width / result.height).toBeCloseTo(STANDARD_CARD_WIDTH_MM / STANDARD_CARD_HEIGHT_MM, 5);
  });

  it("never returns a size smaller than the source in either dimension", () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 2000, height: 2000 },
      { width: 900, height: 1400 },
      { width: 1400, height: 900 },
    ];
    for (const source of sizes) {
      const result = canonicalCardSizeFor(source);
      expect(result.width).toBeGreaterThanOrEqual(source.width);
      expect(result.height).toBeGreaterThanOrEqual(source.height);
    }
  });
});

describe("computeRegionPixelRects", () => {
  it("maps mm-space regions onto the card image's actual pixel size", () => {
    const regions: RegionConfig[] = [
      { label: "collector_number", type: "text", xMm: 2.7, yMm: 79.0, widthMm: 7.5, heightMm: 6.0, rotationDeg: -45 },
    ];
    // 733x1024 is the standard 63x88mm card at ~11.63 px/mm.
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });

    expect(result).toHaveLength(1);
    const [region] = result;
    expect(region!.label).toBe("collector_number");
    expect(region!.type).toBe("text");
    expect(region!.rotationDeg).toBe(-45);
    expect(region!.rect.origin.x).toBeCloseTo((2.7 / 63) * 733, 3);
    expect(region!.rect.origin.y).toBeCloseTo((79.0 / 88) * 1024, 3);
    expect(region!.rect.size.width).toBeCloseTo((7.5 / 63) * 733, 3);
    expect(region!.rect.size.height).toBeCloseTo((6.0 / 88) * 1024, 3);
  });

  it("carries allowedCharsRegex through unchanged, and leaves it undefined when absent", () => {
    const regions: RegionConfig[] = [
      { label: "collector_number", type: "text", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, allowedCharsRegex: "[0-9]" },
      { label: "set_symbol", type: "image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
    ];
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });

    expect(result[0]!.allowedCharsRegex).toBe("[0-9]");
    expect(result[1]!.allowedCharsRegex).toBeUndefined();
    expect(result[1]!.rotationDeg).toBeUndefined();
  });

  it("preserves region order and handles an empty region list", () => {
    const regions: RegionConfig[] = [
      { label: "a", type: "text", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
      { label: "b", type: "image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
    ];
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });
    expect(result.map((r) => r.label)).toEqual(["a", "b"]);

    expect(computeRegionPixelRects([], { width: 733, height: 1024 })).toEqual([]);
  });
});

describe("filterAllowedChars", () => {
  it("keeps only digits when filtered against a digit class", () => {
    expect(filterAllowedChars(";001'", "[0-9]")).toBe("001");
  });

  it("keeps letters, digits, hyphen, brackets and space when filtered against that class", () => {
    expect(filterAllowedChars("MSO1 - WNC [A.", "[A-Za-z0-9\\-\\[\\] ]")).toBe("MSO1 - WNC [A");
  });

  it("returns an empty string when nothing matches", () => {
    expect(filterAllowedChars(";;;'''", "[0-9]")).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(filterAllowedChars("", "[0-9]")).toBe("");
  });
});

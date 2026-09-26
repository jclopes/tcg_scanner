import { describe, expect, it } from "vitest";
import { CANONICAL_CARD_MIN_PX_PER_MM, STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import { canonicalCardSizeFor, filterAllowedChars, padRegion } from "./identification";
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

describe("padRegion", () => {
  it("grows the box by the padding on each side, leaving everything else unchanged", () => {
    const region: RegionConfig = {
      label: "set_code",
      type: "text",
      xMm: 73,
      yMm: 59.5,
      widthMm: 12.6,
      heightMm: 1.9,
      rotationDeg: -90,
      allowedCharsRegex: "[A-Z]",
    };

    const padded = padRegion(region, { xMm: 1.5, yMm: 1 });

    expect(padded).toEqual({ ...region, xMm: 71.5, yMm: 58.5, widthMm: 15.6, heightMm: 3.9 });
  });
});

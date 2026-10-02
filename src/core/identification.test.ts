import { describe, expect, it } from "vitest";
import { CANONICAL_CARD_MIN_PX_PER_MM, STANDARD_CARD_ASPECT_RATIO } from "./constants";
import { canonicalCardSizeFor, filterAllowedChars } from "./identification";

describe("canonicalCardSizeFor", () => {
  it("floors a tiny source at CANONICAL_CARD_MIN_PX_PER_MM", () => {
    expect(canonicalCardSizeFor({ width: 100, height: 100 })).toEqual({
      width: 63 * CANONICAL_CARD_MIN_PX_PER_MM,
      height: 88 * CANONICAL_CARD_MIN_PX_PER_MM,
    });
  });

  it("is exactly card-shaped and never smaller than the source on either axis", () => {
    for (const source of [
      { width: 2000, height: 2000 },
      { width: 900, height: 1400 },
      { width: 1400, height: 900 },
      { width: 63 * 20, height: 88 * 10 },
    ]) {
      const size = canonicalCardSizeFor(source);
      expect(size.width).toBeGreaterThanOrEqual(source.width);
      expect(size.height).toBeGreaterThanOrEqual(source.height);
      expect(size.width / size.height).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 2);
    }
  });
});

describe("filterAllowedChars", () => {
  it("keeps only the allowed characters, in order", () => {
    expect(filterAllowedChars("MSO1 - WNC [A.", "[A-Za-z0-9\\-\\[\\] ]")).toBe("MSO1 - WNC [A");
    expect(filterAllowedChars(";;;'", "[0-9]")).toBe("");
  });
});

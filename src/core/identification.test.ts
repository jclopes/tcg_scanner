import { describe, expect, it } from "vitest";
import { CANONICAL_CARD_MIN_PX_PER_MM, DEFAULT_TEXT_EXTRACT_REGEX, STANDARD_CARD_ASPECT_RATIO } from "./constants";
import { canonicalCardSizeFor, extractMatch, filterAllowedChars } from "./identification";

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
    expect(filterAllowedChars("MSO1 - WNC [A.", "ACMNOSW01 -[]")).toBe("MSO1 - WNC [A");
    expect(filterAllowedChars(";;;'", "0123456789")).toBe("");
  });
});

describe("extractMatch", () => {
  it("keeps the first match", () => {
    expect(extractMatch("066a/298", "^[^/]+")).toBe("066a");
    expect(extractMatch("304*/298", "^[^/]+")).toBe("304*");
    expect(extractMatch("T01", "^[^/]+")).toBe("T01");
  });

  it("is empty when the text doesn't match", () => {
    expect(extractMatch("/298", "^[^/]+")).toBe("");
    expect(extractMatch("", "^[^/]+")).toBe("");
  });

  it("keeps the whole text with the default regex", () => {
    expect(extractMatch("MS01 - WNC [A]", DEFAULT_TEXT_EXTRACT_REGEX)).toBe("MS01 - WNC [A]");
  });
});

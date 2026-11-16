import { describe, expect, it } from "vitest";
import { CANONICAL_CARD_MIN_PX_PER_MM, DEFAULT_TEXT_EXTRACT_REGEX, STANDARD_CARD_ASPECT_RATIO } from "./constants";
import { canonicalCardSizeFor, extractMatch, filterAllowedChars, joinScoredChars, minConfidence } from "./identification";
import type { ScoredChar } from "./identification";

/** `text`'s characters, each confidence 100 minus its index — so operations
 * that keep/drop/reorder characters can be checked by their confidences too. */
function scored(text: string): ScoredChar[] {
  return [...text].map((char, i) => ({ char, confidence: 100 - i }));
}

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
    expect(joinScoredChars(filterAllowedChars(scored("MSO1 - WNC [A."), "ACMNOSW01 -[]"))).toBe("MSO1 - WNC [A");
    expect(filterAllowedChars(scored(";;;'"), "0123456789")).toEqual([]);
  });

  it("keeps each surviving character's own confidence", () => {
    // "M"=100, "S"=99, "1"=97 (index 2 is "O", dropped) in "MSO1".
    expect(filterAllowedChars(scored("MSO1"), "M1S")).toEqual([
      { char: "M", confidence: 100 },
      { char: "S", confidence: 99 },
      { char: "1", confidence: 97 },
    ]);
  });
});

describe("extractMatch", () => {
  it("keeps the first match", () => {
    expect(joinScoredChars(extractMatch(scored("066a/298"), "^[^/]+"))).toBe("066a");
    expect(joinScoredChars(extractMatch(scored("304*/298"), "^[^/]+"))).toBe("304*");
    expect(joinScoredChars(extractMatch(scored("T01"), "^[^/]+"))).toBe("T01");
  });

  it("is empty when the text doesn't match", () => {
    expect(extractMatch(scored("/298"), "^[^/]+")).toEqual([]);
    expect(extractMatch(scored(""), "^[^/]+")).toEqual([]);
  });

  it("keeps the whole text with the default regex", () => {
    expect(joinScoredChars(extractMatch(scored("MS01 - WNC [A]"), DEFAULT_TEXT_EXTRACT_REGEX))).toBe("MS01 - WNC [A]");
  });

  it("keeps the matched slice's own confidences, not the whole string's", () => {
    // "001/298": match is "001" (indices 0-2, confidences 100,99,98).
    expect(extractMatch(scored("001/298"), "^[^/]+")).toEqual([
      { char: "0", confidence: 100 },
      { char: "0", confidence: 99 },
      { char: "1", confidence: 98 },
    ]);
  });
});

describe("minConfidence", () => {
  it("is the weakest character's confidence", () => {
    expect(minConfidence(scored("abc"))).toBe(98);
  });

  it("is 0 for an empty list", () => {
    expect(minConfidence([])).toBe(0);
  });

  it("skips characters with no confidence (e.g. an inferred space), not treating them as maximally confident", () => {
    const withGap: ScoredChar[] = [
      { char: "a", confidence: 60 },
      { char: " ", confidence: null },
      { char: "b", confidence: 90 },
    ];
    expect(minConfidence(withGap)).toBe(60); // the null space doesn't count, so "a" (60) is the weakest
  });

  it("is 0 when nothing in the list was actually OCR'd", () => {
    expect(minConfidence([{ char: " ", confidence: null }])).toBe(0);
  });
});

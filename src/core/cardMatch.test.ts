import { describe, expect, it } from "vitest";
import { closerSetPrints, findCardId, isConfidentMatch, levenshteinDistance, rankCardIds } from "./cardMatch";

describe("levenshteinDistance", () => {
  it("counts single-character substitutions, insertions and deletions", () => {
    expect(levenshteinDistance("005a", "005a")).toBe(0);
    expect(levenshteinDistance("008", "003")).toBe(1);
    expect(levenshteinDistance("β001", "001")).toBe(1);
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("", "012")).toBe(3);
  });
});

describe("rankCardIds", () => {
  it("orders by distance, keeps set order on ties, and returns at most `limit`", () => {
    expect(rankCardIds("005", ["013", "005b", "005a", "005"], 3)).toEqual([
      { id: "005", distance: 0 },
      { id: "005b", distance: 1 },
      { id: "005a", distance: 1 },
    ]);
  });

  it("suggests nothing when OCR read nothing", () => {
    expect(rankCardIds("", ["001", "002"], 3)).toEqual([]);
  });
});

describe("isConfidentMatch", () => {
  it("accepts a best match up to 2 edits away, and nothing else", () => {
    expect(isConfidentMatch([{ id: "001", distance: 2 }, { id: "002", distance: 3 }])).toBe(true);
    expect(isConfidentMatch([{ id: "001", distance: 3 }])).toBe(false);
    expect(isConfidentMatch([])).toBe(false);
  });
});

describe("findCardId", () => {
  const ids = ["001", "005a", "β001"];

  it("finds a typed ID ignoring case and surrounding spaces, returning the set's own spelling", () => {
    expect(findCardId("  005A ", ids)).toBe("005a");
    expect(findCardId("β001", ids)).toBe("β001");
  });

  it("returns null for an ID the set doesn't have", () => {
    expect(findCardId("002", ids)).toBeNull();
    expect(findCardId("", ids)).toBeNull();
  });
});

describe("closerSetPrints", () => {
  const heist = { name: "Heist", print: "SD01 - HEI [A]" };
  const power = { name: "Power", print: "SD02 - EBP [A]" };
  const retail = { name: "Retail", print: "MS01 - WNC [A]" };
  const beta = { name: "Beta", print: "MS01 - WNC [A]" };
  const sets = [heist, power, retail, beta];

  it("is empty when the selected set's print is the closest, even misread or tied with another set", () => {
    expect(closerSetPrints("SDO2 - EBP [A", power, sets)).toEqual([]);
    expect(closerSetPrints("MS01 - WNC [A]", retail, sets)).toEqual([]);
  });

  it("returns every set whose print is closer, ignoring spacing", () => {
    expect(closerSetPrints("SD01-HEI[A]", power, sets)).toEqual([heist]);
    expect(closerSetPrints("MS01 - WNC [A]", heist, sets)).toEqual([retail, beta]);
  });

  it("is case-sensitive", () => {
    expect(closerSetPrints("sd01 - hei [a]", heist, sets)).toEqual([]);
  });

  it("is empty when OCR read nothing", () => {
    expect(closerSetPrints("  ", power, sets)).toEqual([]);
  });
});

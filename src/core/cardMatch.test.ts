import { describe, expect, it } from "vitest";
import { findCardId, isConfidentMatch, levenshteinDistance, matchesSetPrint, rankCardIds } from "./cardMatch";

describe("levenshteinDistance", () => {
  it("is 0 for identical strings", () => {
    expect(levenshteinDistance("005a", "005a")).toBe(0);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(levenshteinDistance("008", "003")).toBe(1);
    expect(levenshteinDistance("β001", "001")).toBe(1);
    expect(levenshteinDistance("05", "005")).toBe(1);
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("is the other string's length when one is empty", () => {
    expect(levenshteinDistance("", "012")).toBe(3);
    expect(levenshteinDistance("012", "")).toBe(3);
  });
});

describe("rankCardIds", () => {
  const ids = ["001", "002", "003", "005a", "005b", "008", "013"];

  it("puts an exact match first", () => {
    expect(rankCardIds("003", ids, 3)[0]).toEqual({ id: "003", distance: 0 });
  });

  it("orders by distance and breaks ties by candidate order", () => {
    expect(rankCardIds("005", ["013", "005b", "005a", "005"], 3)).toEqual([
      { id: "005", distance: 0 },
      { id: "005b", distance: 1 },
      { id: "005a", distance: 1 },
    ]);
  });

  it("returns at most `limit` matches", () => {
    expect(rankCardIds("0", ids, 2)).toHaveLength(2);
    expect(rankCardIds("0", ids, 20)).toHaveLength(ids.length);
  });

  it("returns nothing for empty OCR text", () => {
    expect(rankCardIds("", ids, 3)).toEqual([]);
  });
});

describe("isConfidentMatch", () => {
  it("accepts a best match up to 2 edits away", () => {
    expect(isConfidentMatch([{ id: "001", distance: 0 }])).toBe(true);
    expect(isConfidentMatch([{ id: "001", distance: 2 }, { id: "002", distance: 3 }])).toBe(true);
  });

  it("rejects a best match more than 2 edits away", () => {
    expect(isConfidentMatch([{ id: "001", distance: 3 }])).toBe(false);
  });

  it("rejects no matches (no OCR text)", () => {
    expect(isConfidentMatch([])).toBe(false);
  });
});

describe("findCardId", () => {
  const ids = ["001", "005a", "β001"];

  it("finds an exact ID", () => {
    expect(findCardId("β001", ids)).toBe("β001");
  });

  it("ignores case and surrounding whitespace, returning the set's own spelling", () => {
    expect(findCardId("  005A ", ids)).toBe("005a");
  });

  it("returns null for an ID the set doesn't have", () => {
    expect(findCardId("002", ids)).toBeNull();
    expect(findCardId("", ids)).toBeNull();
  });
});

describe("matchesSetPrint", () => {
  it("matches the printed code, ignoring spacing", () => {
    expect(matchesSetPrint("MS01 - WNC [A]", "MS01 - WNC [A]")).toBe(true);
    expect(matchesSetPrint("MS01-WNC[A]", "MS01 - WNC [A]")).toBe(true);
  });

  it("tolerates up to 2 OCR misreads", () => {
    expect(matchesSetPrint("MSO1 - WNC [A", "MS01 - WNC [A]")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(matchesSetPrint("ms01 - wnc [a]", "MS01 - WNC [A]")).toBe(false);
  });

  it("rejects another set's code", () => {
    expect(matchesSetPrint("SD01 - HEI [A]", "SD02 - EBP [A]")).toBe(false);
    expect(matchesSetPrint("PRM - DD1 [A]", "PRM - WNC [A]")).toBe(false);
  });

  it("rejects empty OCR text", () => {
    expect(matchesSetPrint("", "PRM01")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { closerSetPrints, findCardId, isConfidentMatch, levenshteinDistance, rankCardIds } from "./cardMatch";

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

describe("closerSetPrints", () => {
  const heist = { name: "Heist", print: "SD01 - HEI [A]" };
  const power = { name: "Power", print: "SD02 - EBP [A]" };
  const retail = { name: "Retail", print: "MS01 - WNC [A]" };
  const beta = { name: "Beta", print: "MS01 - WNC [A]" };
  const sets = [heist, power, retail, beta];

  it("is empty when the selected set's print is the closest", () => {
    expect(closerSetPrints("SD02 - EBP [A]", power, sets)).toEqual([]);
    expect(closerSetPrints("SDO2 - EBP [A", power, sets)).toEqual([]);
  });

  it("is empty when another set is only as close (a tie)", () => {
    expect(closerSetPrints("MS01 - WNC [A]", retail, sets)).toEqual([]);
  });

  it("returns the closer set, ignoring spacing", () => {
    expect(closerSetPrints("SD01-HEI[A]", power, sets)).toEqual([heist]);
  });

  it("returns every set sharing the closest print", () => {
    expect(closerSetPrints("MS01 - WNC [A]", heist, sets)).toEqual([retail, beta]);
  });

  it("is case-sensitive", () => {
    expect(closerSetPrints("sd01 - hei [a]", heist, sets)).toEqual([]);
  });

  it("is empty when OCR read nothing", () => {
    expect(closerSetPrints("  ", power, sets)).toEqual([]);
  });
});

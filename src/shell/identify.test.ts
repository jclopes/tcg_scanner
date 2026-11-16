import { describe, expect, it } from "vitest";
import type { ScoredChar } from "../core";
import { trimToCollectorNumberLength } from "./identify";
import type { GameSet } from "./gameConfig";

function set(collectorNumberPrefix: string): GameSet {
  return { code: "s", name: "Set", print: "S01", collectorNumbers: [`${collectorNumberPrefix}001`], collectorNumberPrefix };
}

function chars(text: string): ScoredChar[] {
  return [...text].map((char) => ({ char, confidence: 90 }));
}

describe("trimToCollectorNumberLength", () => {
  it("drops the excess leading characters OCR produced for the prefix glyph", () => {
    // 1 extra character (the prefix misread as some digit).
    expect(trimToCollectorNumberLength(chars("8001"), set("β"))).toEqual(chars("001"));
    // 2 extra characters.
    expect(trimToCollectorNumberLength(chars("ZZ001"), set("ZZ"))).toEqual(chars("001"));
  });

  it("leaves the reading unchanged when it's already at (or under) the expected length", () => {
    // The prefix glyph produced 0 characters (its own guess wasn't an
    // allowed character, so it got filtered out entirely) — nothing to trim.
    expect(trimToCollectorNumberLength(chars("001"), set("β"))).toEqual(chars("001"));
    expect(trimToCollectorNumberLength(chars("01"), set("β"))).toEqual(chars("01"));
  });

  it("leaves the reading unchanged for a set with no prefix", () => {
    expect(trimToCollectorNumberLength(chars("001"), set(""))).toEqual(chars("001"));
  });

  it("leaves the reading unchanged when there's no set (Autodetect read no set code)", () => {
    expect(trimToCollectorNumberLength(chars("8001"), null)).toEqual(chars("8001"));
  });

  it("is empty, not an error, on an empty reading", () => {
    expect(trimToCollectorNumberLength([], set("β"))).toEqual([]);
  });
});

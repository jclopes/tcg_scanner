import { describe, expect, it } from "vitest";
import { PRINT_PLACEHOLDER, buildSet, normalizeCollectorNumber } from "./cyberpunkSets.mjs";

const OPTION = { code: "s", name: "Set" };

describe("normalizeCollectorNumber", () => {
  it("zero-pads the digits to 3", () => {
    expect(normalizeCollectorNumber("10")).toBe("010");
    expect(normalizeCollectorNumber("β5a")).toBe("β005a");
  });

  it("keeps an already padded number, with its beta prefix and variant letter", () => {
    expect(normalizeCollectorNumber("β005a")).toBe("β005a");
    expect(normalizeCollectorNumber("171")).toBe("171");
  });

  it("throws on anything else", () => {
    expect(() => normalizeCollectorNumber("A01")).toThrow(/"A01"/);
    expect(() => normalizeCollectorNumber("")).toThrow(/collector number/);
  });
});

describe("buildSet", () => {
  it("keeps the local set's print and takes the name from the site", () => {
    const set = buildSet(OPTION, ["001"], { code: "s", print: "MS01 - WNC [A]", name: "Old name", collector_numbers: ["001"] });
    expect(set).toEqual({ code: "s", print: "MS01 - WNC [A]", name: "Set", collector_numbers: ["001"] });
  });

  it("gives a set the local file doesn't have the placeholder print", () => {
    expect(buildSet(OPTION, ["001"], undefined).print).toBe(PRINT_PLACEHOLDER);
  });

  it("sorts, dedupes and normalizes the collector numbers", () => {
    expect(buildSet(OPTION, ["10", "005b", "001", "005a", "010"], undefined).collector_numbers).toEqual(["001", "005a", "005b", "010"]);
  });

  it("adds the beta prefix only when every collector number has it", () => {
    expect(buildSet(OPTION, ["β001", "β002"], undefined).collector_number_prefix).toBe("β");
    expect(buildSet(OPTION, ["β001", "002"], undefined)).not.toHaveProperty("collector_number_prefix");
  });

  it("throws when the set has no cards", () => {
    expect(() => buildSet(OPTION, [], undefined)).toThrow(/"s" has no cards/);
  });
});

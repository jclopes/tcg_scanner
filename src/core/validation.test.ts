import { describe, expect, it } from "vitest";
import {
  optionalNumber,
  optionalString,
  requireArray,
  requireBoolean,
  requireList,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
  requireUnique,
} from "./validation";

const CONTEXT = 'Game "g" region "r"';

describe("requireRecord / requireList", () => {
  it("accept an object / a list", () => {
    expect(requireRecord({ a: 1 }, CONTEXT)).toEqual({ a: 1 });
    expect(requireList([1], CONTEXT)).toEqual([1]);
  });

  it("reject anything else, naming the context", () => {
    for (const value of [null, [], "x", 1, undefined]) {
      expect(() => requireRecord(value, CONTEXT)).toThrow(`${CONTEXT} must be an object`);
    }
    expect(() => requireList({}, CONTEXT)).toThrow(`${CONTEXT} must be a list`);
  });
});

describe("requireNumber / optionalNumber", () => {
  it("returns a finite number", () => {
    expect(requireNumber({ x_mm: 1.5 }, "x_mm", CONTEXT)).toBe(1.5);
    expect(optionalNumber({ x_mm: 0 }, "x_mm", CONTEXT)).toBe(0);
  });

  it("names the context and field for a missing or non-numeric value", () => {
    expect(() => requireNumber({ x_m: 1 }, "x_mm", CONTEXT)).toThrow(`${CONTEXT}: "x_mm" must be a number, got nothing.`);
    expect(() => requireNumber({ x_mm: "1" }, "x_mm", CONTEXT)).toThrow('got "1"');
    expect(() => requireNumber({ x_mm: Number.NaN }, "x_mm", CONTEXT)).toThrow(/must be a number/);
  });

  it("optionalNumber allows absence but not a wrong type", () => {
    expect(optionalNumber({}, "rotation_deg", CONTEXT)).toBeUndefined();
    expect(() => optionalNumber({ rotation_deg: "45" }, "rotation_deg", CONTEXT)).toThrow(/must be a number/);
  });
});

describe("requireString / optionalString / requireBoolean", () => {
  it("returns valid values", () => {
    expect(requireString({ code: "S1" }, "code", CONTEXT)).toBe("S1");
    expect(optionalString({}, "code", CONTEXT)).toBeUndefined();
    expect(requireBoolean({ foil: false }, "foil", CONTEXT)).toBe(false);
  });

  it("rejects empty, missing or mistyped values", () => {
    expect(() => requireString({ code: "" }, "code", CONTEXT)).toThrow(/non-empty string/);
    expect(() => requireString({ code: 1 }, "code", CONTEXT)).toThrow(/non-empty string/);
    expect(() => requireBoolean({ foil: "yes" }, "foil", CONTEXT)).toThrow(/true or false/);
  });
});

describe("requireArray / requireStringArray / requireUnique", () => {
  it("returns lists", () => {
    expect(requireArray({ regions: [] }, "regions", CONTEXT)).toEqual([]);
    expect(requireStringArray({ ids: ["001", "002"] }, "ids", CONTEXT)).toEqual(["001", "002"]);
  });

  it("rejects an empty, mixed or repeating string list", () => {
    expect(() => requireArray({}, "regions", CONTEXT)).toThrow(/must be a list/);
    expect(() => requireStringArray({ ids: [] }, "ids", CONTEXT)).toThrow(/non-empty list/);
    expect(() => requireStringArray({ ids: ["001", 2] }, "ids", CONTEXT)).toThrow(/non-empty list/);
    expect(() => requireStringArray({ ids: ["001", "001"] }, "ids", CONTEXT)).toThrow('has "001" more than once');
  });

  it("requireUnique names the repeated value", () => {
    expect(() => requireUnique(["a", "b", "a"], "region labels", CONTEXT)).toThrow(
      `${CONTEXT}: region labels has "a" more than once.`,
    );
    expect(() => requireUnique(["a", "b"], "region labels", CONTEXT)).not.toThrow();
  });
});

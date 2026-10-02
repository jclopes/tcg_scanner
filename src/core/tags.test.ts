import { describe, expect, it } from "vitest";
import { parseTags } from "./tags";

describe("parseTags", () => {
  it("splits tags on any whitespace", () => {
    expect(parseTags("  #box-01 \t  #booster-01  ")).toEqual({ tags: ["#box-01", "#booster-01"], invalid: [] });
  });

  it("drops duplicate tags, keeping the first", () => {
    expect(parseTags("#box-01 #booster-01 #box-01").tags).toEqual(["#box-01", "#booster-01"]);
  });

  it("reports tokens that don't start with # or are just #", () => {
    expect(parseTags("box-01 #booster-01 # #a#b")).toEqual({ tags: ["#booster-01"], invalid: ["box-01", "#", "#a#b"] });
  });
});

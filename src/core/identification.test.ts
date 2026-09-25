import { describe, expect, it } from "vitest";
import { computeRegionPixelRects, filterAllowedChars } from "./identification";
import type { RegionConfig } from "./identification";

describe("computeRegionPixelRects", () => {
  it("maps mm-space regions onto the card image's actual pixel size", () => {
    const regions: RegionConfig[] = [
      { label: "collector_number", type: "text", xMm: 2.7, yMm: 79.0, widthMm: 7.5, heightMm: 6.0, rotationDeg: -45 },
    ];
    // 733x1024 is the standard 63x88mm card at ~11.63 px/mm.
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });

    expect(result).toHaveLength(1);
    const [region] = result;
    expect(region!.label).toBe("collector_number");
    expect(region!.type).toBe("text");
    expect(region!.rotationDeg).toBe(-45);
    expect(region!.rect.origin.x).toBeCloseTo((2.7 / 63) * 733, 3);
    expect(region!.rect.origin.y).toBeCloseTo((79.0 / 88) * 1024, 3);
    expect(region!.rect.size.width).toBeCloseTo((7.5 / 63) * 733, 3);
    expect(region!.rect.size.height).toBeCloseTo((6.0 / 88) * 1024, 3);
  });

  it("carries allowedCharsRegex through unchanged, and leaves it undefined when absent", () => {
    const regions: RegionConfig[] = [
      { label: "collector_number", type: "text", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, allowedCharsRegex: "[0-9]" },
      { label: "set_symbol", type: "image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
    ];
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });

    expect(result[0]!.allowedCharsRegex).toBe("[0-9]");
    expect(result[1]!.allowedCharsRegex).toBeUndefined();
    expect(result[1]!.rotationDeg).toBeUndefined();
  });

  it("preserves region order and handles an empty region list", () => {
    const regions: RegionConfig[] = [
      { label: "a", type: "text", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
      { label: "b", type: "image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
    ];
    const result = computeRegionPixelRects(regions, { width: 733, height: 1024 });
    expect(result.map((r) => r.label)).toEqual(["a", "b"]);

    expect(computeRegionPixelRects([], { width: 733, height: 1024 })).toEqual([]);
  });
});

describe("filterAllowedChars", () => {
  it("keeps only digits when filtered against a digit class", () => {
    expect(filterAllowedChars(";001'", "[0-9]")).toBe("001");
  });

  it("keeps letters, digits, hyphen, brackets and space when filtered against that class", () => {
    expect(filterAllowedChars("MSO1 - WNC [A.", "[A-Za-z0-9\\-\\[\\] ]")).toBe("MSO1 - WNC [A");
  });

  it("returns an empty string when nothing matches", () => {
    expect(filterAllowedChars(";;;'''", "[0-9]")).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(filterAllowedChars("", "[0-9]")).toBe("");
  });
});

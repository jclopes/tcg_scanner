import { describe, expect, it } from "vitest";
import { listGames, parseGame, parseRegion } from "./gameConfig";
import type { RawGameConfig, RawRegionConfig } from "./gameConfig";

const BOX = { label: "collector_number", x_mm: 1, y_mm: 2, width_mm: 3, height_mm: 4 };

describe("parseRegion", () => {
  it("translates a text region to camelCase", () => {
    const raw: RawRegionConfig = { ...BOX, type: "text", allowed_chars_regex: "[0-9]", rotation_deg: -45, max_gap_text_heights: 0.5 };
    expect(parseRegion("game", raw)).toEqual({
      label: "collector_number",
      type: "text",
      xMm: 1,
      yMm: 2,
      widthMm: 3,
      heightMm: 4,
      rotationDeg: -45,
      allowedCharsRegex: "[0-9]",
      maxGapTextHeights: 0.5,
    });
  });

  it("drops text-only fields from an image region", () => {
    const raw: RawRegionConfig = { ...BOX, type: "image", allowed_chars_regex: "[0-9]" };
    expect(parseRegion("game", raw)).not.toHaveProperty("allowedCharsRegex");
  });

  it("throws for a text region without allowed_chars_regex", () => {
    expect(() => parseRegion("game", { ...BOX, type: "text" })).toThrow(/allowed_chars_regex/);
  });

  it("throws for an unknown region type", () => {
    expect(() => parseRegion("game", { ...BOX, type: "barcode" })).toThrow(/unknown type "barcode"/);
  });
});

describe("listGames", () => {
  it("parses every bundled game, sorted by id, with sets sorted by name", () => {
    const games = listGames();
    expect(games.length).toBeGreaterThan(0);
    expect(games.map((game) => game.id)).toEqual(games.map((game) => game.id).sort((a, b) => a.localeCompare(b)));
    for (const game of games) {
      const names = game.sets.map((set) => set.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("parseGame", () => {
  const SETS = [{ code: "S1", name: "Set 1", print: "S1 - X", collector_numbers: ["001"] }];
  const config = (overrides: Partial<RawGameConfig>): RawGameConfig => ({
    game: "game",
    card_formats: ["portrait", "landscape"],
    foil: true,
    regions: [],
    ...overrides,
  });

  it("reads card formats and foil support", () => {
    const game = parseGame("g", config({ card_formats: ["landscape"], foil: false }), SETS);
    expect(game.cardFormats).toEqual(["landscape"]);
    expect(game.hasFoil).toBe(false);
  });

  it("throws for missing, empty, unknown or repeated card formats", () => {
    for (const card_formats of [undefined, [], ["square"], ["portrait", "portrait"]]) {
      expect(() => parseGame("g", config({ card_formats }), SETS)).toThrow(/card_formats/);
    }
  });

  it("throws for a missing or non-boolean foil", () => {
    for (const foil of [undefined, "yes"]) {
      expect(() => parseGame("g", config({ foil }), SETS)).toThrow(/foil/);
    }
  });

  it("reads each set's printed code", () => {
    expect(parseGame("g", config({}), SETS).sets[0]!.print).toBe("S1 - X");
  });

  it("throws for a set without a print", () => {
    for (const print of [undefined, ""]) {
      expect(() => parseGame("g", config({}), [{ ...SETS[0]!, print }])).toThrow(/print/);
    }
  });

  it("throws when regions.json or sets.json is missing, or there are no sets", () => {
    expect(() => parseGame("g", undefined, SETS)).toThrow(/regions.json and sets.json/);
    expect(() => parseGame("g", config({}), undefined)).toThrow(/regions.json and sets.json/);
    expect(() => parseGame("g", config({}), [])).toThrow(/no sets/);
  });
});

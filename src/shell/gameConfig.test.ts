import { describe, expect, it } from "vitest";
import { listGames, parseGame, parseRegion } from "./gameConfig";

const BOX = { label: "collector_number", x_mm: 1, y_mm: 2, width_mm: 3, height_mm: 4 };

describe("parseRegion", () => {
  it("translates a text region to camelCase", () => {
    const raw = { ...BOX, type: "text", allowed_chars_regex: "[0-9]", rotation_deg: -45, max_gap_text_heights: 0.5 };
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
    expect(parseRegion("game", { ...BOX, type: "image", allowed_chars_regex: "[0-9]" })).not.toHaveProperty(
      "allowedCharsRegex",
    );
  });

  it("throws for a text region without a valid allowed_chars_regex", () => {
    expect(() => parseRegion("game", { ...BOX, type: "text" })).toThrow(/allowed_chars_regex/);
    expect(() => parseRegion("game", { ...BOX, type: "text", allowed_chars_regex: "[0-9" })).toThrow(
      /isn't a valid regular expression/,
    );
  });

  it("throws for an unknown region type", () => {
    expect(() => parseRegion("game", { ...BOX, type: "barcode" })).toThrow(/unknown type "barcode"/);
  });

  it("names the region and field for a missing or mistyped position", () => {
    const { x_mm: _removed, ...withoutX } = BOX;
    expect(() => parseRegion("game", { ...withoutX, x_m: 1, type: "image" })).toThrow(
      'Game "game" regions.json region "collector_number": "x_mm" must be a number, got nothing.',
    );
    expect(() => parseRegion("game", { ...BOX, y_mm: "2", type: "image" })).toThrow(/"y_mm" must be a number/);
  });

  it("throws for a non-positive size", () => {
    expect(() => parseRegion("game", { ...BOX, width_mm: 0, type: "image" })).toThrow(/"width_mm" must be positive/);
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
  const SET = { code: "S1", name: "Set 1", print: "S1 - X", collector_numbers: ["001"] };
  const SETS = [SET];
  const config = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    game: "game",
    card_orientation: ["portrait", "landscape"],
    foil: true,
    regions: [],
    ...overrides,
  });

  it("reads card orientations and foil support", () => {
    const game = parseGame("g", config({ card_orientation: ["landscape"], foil: false }), SETS);
    expect(game.cardOrientations).toEqual(["landscape"]);
    expect(game.hasFoil).toBe(false);
  });

  it("throws for missing, empty, unknown or repeated card orientations", () => {
    for (const card_orientation of [undefined, [], ["square"], ["portrait", "portrait"]]) {
      expect(() => parseGame("g", config({ card_orientation }), SETS)).toThrow(/card_orientation/);
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
      expect(() => parseGame("g", config({}), [{ ...SET, print }])).toThrow(/print/);
    }
  });

  it("throws for a set with missing, non-string or repeated collector numbers", () => {
    for (const collector_numbers of [undefined, [], ["001", 2], ["001", "001"]]) {
      expect(() => parseGame("g", config({}), [{ ...SET, collector_numbers }])).toThrow(/collector_numbers/);
    }
  });

  it("throws for repeated set codes or region labels", () => {
    expect(() => parseGame("g", config({}), [SET, { ...SET, name: "Other" }])).toThrow(/set codes has "S1"/);
    const region = { ...BOX, type: "image" };
    expect(() => parseGame("g", config({ regions: [region, region] }), SETS)).toThrow(
      /region labels has "collector_number"/,
    );
  });

  it("throws when regions.json or sets.json is missing or malformed, or there are no sets", () => {
    expect(() => parseGame("g", undefined, SETS)).toThrow(/regions.json and sets.json/);
    expect(() => parseGame("g", config({}), undefined)).toThrow(/regions.json and sets.json/);
    expect(() => parseGame("g", config({}), [])).toThrow(/no sets/);
    expect(() => parseGame("g", config({}), { sets: [] })).toThrow(/sets.json must be a list/);
    expect(() => parseGame("g", config({ regions: undefined }), SETS)).toThrow(/"regions" must be a list/);
  });
});

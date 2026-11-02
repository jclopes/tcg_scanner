import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS, DEFAULT_TEXT_EXTRACT_REGEX, DEFAULT_TEXT_SEARCH_PADDING_Y_MM } from "../core";
import { listGames, loadGame, parseGameOption, parseRegion, parseSets } from "./gameConfig";

const BOX = { label: "collector_number", x_mm: 1, y_mm: 2, width_mm: 3, height_mm: 4 };

const textRegion = (label: string): Record<string, unknown> => ({ ...BOX, label, type: "text", allowed_chars: "0123456789" });
const REQUIRED_REGIONS = [textRegion("collector_number"), textRegion("set_code")];

describe("parseRegion", () => {
  it("translates a text region to camelCase", () => {
    const raw = {
      ...BOX,
      type: "text",
      allowed_chars: "0123456789/",
      extract_regex: "^[^/]+",
      rotation_deg: -45,
      max_gap_text_heights: 0.5,
      search_padding_y_mm: 0.2,
    };
    expect(parseRegion("game", "portrait", raw)).toEqual({
      label: "collector_number",
      type: "text",
      xMm: 1,
      yMm: 2,
      widthMm: 3,
      heightMm: 4,
      rotationDeg: -45,
      allowedChars: "0123456789/",
      extractRegex: "^[^/]+",
      maxGapTextHeights: 0.5,
      searchPaddingYMm: 0.2,
    });
  });

  it("fills in no rotation, the default maximum gap and search padding, and the whole text when omitted", () => {
    expect(parseRegion("game", "portrait", textRegion("collector_number"))).toMatchObject({
      rotationDeg: 0,
      extractRegex: DEFAULT_TEXT_EXTRACT_REGEX,
      maxGapTextHeights: DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
      searchPaddingYMm: DEFAULT_TEXT_SEARCH_PADDING_Y_MM,
    });
  });

  it("drops text-only fields from an image region", () => {
    expect(parseRegion("game", "portrait", { ...BOX, type: "image", allowed_chars: "0123456789" })).not.toHaveProperty(
      "allowedChars",
    );
  });

  it("throws for a text region with missing or empty allowed_chars", () => {
    for (const allowed_chars of [undefined, ""]) {
      expect(() => parseRegion("game", "portrait", { ...BOX, type: "text", allowed_chars })).toThrow(/allowed_chars/);
    }
  });

  it("throws for an invalid extract_regex", () => {
    expect(() => parseRegion("game", "portrait", { ...textRegion("collector_number"), extract_regex: "^[^/+" })).toThrow(
      /"extract_regex" isn't a valid regular expression/,
    );
    expect(() => parseRegion("game", "portrait", { ...textRegion("collector_number"), extract_regex: "" })).toThrow(
      /extract_regex/,
    );
  });

  it("throws for an unknown region type", () => {
    expect(() => parseRegion("game", "portrait", { ...BOX, type: "barcode" })).toThrow(/unknown type "barcode"/);
  });

  it("names the region and field for a missing or mistyped position", () => {
    const { x_mm: _removed, ...withoutX } = BOX;
    expect(() => parseRegion("game", "portrait", { ...withoutX, x_m: 1, type: "image" })).toThrow(
      'Game "game" regions.json portrait region "collector_number": "x_mm" must be a number, got nothing.',
    );
    expect(() => parseRegion("game", "portrait", { ...BOX, y_mm: "2", type: "image" })).toThrow(/"y_mm" must be a number/);
  });

  it("throws for a non-positive size", () => {
    expect(() => parseRegion("game", "portrait", { ...BOX, width_mm: 0, type: "image" })).toThrow(/"width_mm" must be positive/);
  });
});

describe("listGames", () => {
  it("parses every bundled game, sorted by id", () => {
    const games = listGames();
    expect(games.length).toBeGreaterThan(0);
    expect(games.map((game) => game.id)).toEqual(games.map((game) => game.id).sort((a, b) => a.localeCompare(b)));
  });
});

describe("loadGame", () => {
  it("loads every bundled game's sets, sorted by name", async () => {
    for (const game of listGames()) {
      const names = (await loadGame(game)).sets.map((set) => set.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("parseGameOption", () => {
  const config = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    card_orientation: ["portrait", "landscape"],
    foil: true,
    regions: { portrait: REQUIRED_REGIONS, landscape: REQUIRED_REGIONS },
    ...overrides,
  });

  it("reads card orientations and foil support", () => {
    const game = parseGameOption("g", config({ card_orientation: ["landscape"], foil: false, regions: { landscape: REQUIRED_REGIONS } }));
    expect(game.cardOrientations).toEqual(["landscape"]);
    expect(game.hasFoil).toBe(false);
  });

  it("throws for missing, empty, unknown or repeated card orientations", () => {
    for (const card_orientation of [undefined, [], ["square"], ["portrait", "portrait"]]) {
      expect(() => parseGameOption("g", config({ card_orientation }))).toThrow(/card_orientation/);
    }
  });

  it("throws for a missing or non-boolean foil", () => {
    for (const foil of [undefined, "yes"]) {
      expect(() => parseGameOption("g", config({ foil }))).toThrow(/foil/);
    }
  });

  it("throws for repeated region labels", () => {
    const region = { ...BOX, type: "image" };
    expect(() => parseGameOption("g", config({ regions: { portrait: [region, region], landscape: REQUIRED_REGIONS } }))).toThrow(
      /portrait region labels has "collector_number"/,
    );
  });

  it("throws when regions.json or its regions are malformed", () => {
    expect(() => parseGameOption("g", undefined)).toThrow(/regions.json must be an object/);
    expect(() => parseGameOption("g", config({ regions: undefined }))).toThrow(/"regions" must be an object/);
  });

  it("keeps each orientation's own regions", () => {
    const portrait = REQUIRED_REGIONS;
    const landscape = REQUIRED_REGIONS.map((region) => ({ ...region, x_mm: 50 }));
    const game = parseGameOption("g", config({ regions: { portrait, landscape } }));
    expect(game.config.regions.portrait![0]!.xMm).toBe(1);
    expect(game.config.regions.landscape![0]!.xMm).toBe(50);
  });

  it("throws when regions lack a listed orientation or have an unlisted one", () => {
    expect(() => parseGameOption("g", config({ regions: { portrait: REQUIRED_REGIONS } }))).toThrow(/"landscape" must be a list/);
    expect(() => parseGameOption("g", config({ card_orientation: ["portrait"], regions: { portrait: [], landscape: [] } }))).toThrow(
      /"regions" has "landscape", which isn't in "card_orientation"/,
    );
  });

  it("throws when an orientation lacks the collector-number or set-code text region", () => {
    const imageSetCode = { ...BOX, label: "set_code", type: "image" };
    for (const portrait of [[textRegion("set_code")], [textRegion("collector_number")], [textRegion("collector_number"), imageSetCode]]) {
      expect(() => parseGameOption("g", config({ card_orientation: ["portrait"], regions: { portrait } }))).toThrow(
        /portrait regions need a text region labeled/,
      );
    }
  });
});

describe("parseSets", () => {
  const SET = { code: "S1", name: "Set 1", print: "S1 - X", collector_numbers: ["001"] };

  it("sorts the sets by name", () => {
    const sets = parseSets("g", [{ ...SET, code: "S2", name: "Zeta" }, SET]);
    expect(sets.map((set) => set.name)).toEqual(["Set 1", "Zeta"]);
  });

  it("throws for a set without a print", () => {
    for (const print of [undefined, ""]) {
      expect(() => parseSets("g", [{ ...SET, print }])).toThrow(/print/);
    }
  });

  it("throws for a set with missing, non-string or repeated collector numbers", () => {
    for (const collector_numbers of [undefined, [], ["001", 2], ["001", "001"]]) {
      expect(() => parseSets("g", [{ ...SET, collector_numbers }])).toThrow(/collector_numbers/);
    }
  });

  it("throws for repeated set codes", () => {
    expect(() => parseSets("g", [SET, { ...SET, name: "Other" }])).toThrow(/set codes has "S1"/);
  });

  it("throws when sets.json isn't a list or has no sets", () => {
    expect(() => parseSets("g", [])).toThrow(/no sets/);
    expect(() => parseSets("g", { sets: [] })).toThrow(/sets.json must be a list/);
  });
});

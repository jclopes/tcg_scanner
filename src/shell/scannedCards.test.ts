import { describe, expect, it } from "vitest";
import type { GameOption } from "./gameConfig";
import { mergeDuplicates, parseScannedCards, scannedCardsCsv } from "./scannedCards";
import type { ScannedCard } from "./scannedCards";

function game(id: string, hasFoil: boolean, cardOrientations: GameOption["cardOrientations"]): GameOption {
  return { id, config: { game: id, regions: [] }, sets: [], cardOrientations, hasFoil };
}

const FULL = game("full", true, ["portrait", "landscape"]);
const PLAIN = game("plain", false, ["portrait"]);
const GAMES = [FULL, PLAIN];

function card(overrides: Partial<ScannedCard>): ScannedCard {
  return {
    gameId: "full",
    setCode: "S1",
    cardId: "001",
    foil: false,
    orientation: "portrait",
    quantity: 1,
    scannedAt: "2026-09-29T10:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

const noLegacyGame = (setCode: string): string => {
  throw new Error(`unexpected lookup of ${setCode}`);
};

describe("parseScannedCards", () => {
  it("returns the stored list, keeping duplicates as separate entries", () => {
    const cards = [card({ foil: true, quantity: 3, tags: ["#box-01"] }), card({ orientation: "landscape" })];
    expect(parseScannedCards(JSON.stringify(cards), noLegacyGame)).toEqual(cards);
  });

  it("fills in fields older entries lack: game from the set, no tags, not foil, no orientation, one copy", () => {
    const stored = [{ setCode: "PRM01", cardId: "005", scannedAt: "2026-09-27T10:00:00.000Z" }];
    expect(parseScannedCards(JSON.stringify(stored), () => "cyberpunk")).toEqual([
      { ...stored[0], gameId: "cyberpunk", tags: [], foil: false, orientation: null, quantity: 1 },
    ]);
  });

  it("returns an empty list for an empty stored list", () => {
    expect(parseScannedCards("[]", noLegacyGame)).toEqual([]);
  });

  it("throws for a stored value that isn't a list of cards", () => {
    for (const json of [
      '{"setCode":"PRM01"}',
      '[{"setCode":"PRM01","cardId":"005"}]',
      '[{"setCode":"PRM01","cardId":"005","scannedAt":"x","tags":"#box-01"}]',
      '[{"setCode":"PRM01","cardId":"005","scannedAt":"x","foil":"yes"}]',
      '[{"setCode":"PRM01","cardId":"005","scannedAt":"x","orientation":"square"}]',
      '[{"setCode":"PRM01","cardId":"005","scannedAt":"x","quantity":0}]',
      '[{"setCode":"PRM01","cardId":"005","scannedAt":"x","quantity":1.5}]',
    ]) {
      expect(() => parseScannedCards(json, noLegacyGame)).toThrow(/corrupted/);
    }
  });

  it("throws for invalid JSON", () => {
    expect(() => parseScannedCards("not json", noLegacyGame)).toThrow();
  });
});

describe("scannedCardsCsv", () => {
  it("includes foil and orientation when the cards' game has them", () => {
    const csv = scannedCardsCsv(
      [card({ foil: true, orientation: "landscape", quantity: 2, tags: ["#a", "#b"] })],
      GAMES,
    );
    expect(csv).toBe(
      "set_id,card_id,foil,orientation,quantity,scanned_at,tags\r\nS1,001,true,landscape,2,2026-09-29T10:00:00.000Z,#a #b\r\n",
    );
  });

  it("leaves out foil and orientation when no card's game has them", () => {
    const csv = scannedCardsCsv([card({ gameId: "plain", foil: false })], GAMES);
    expect(csv).toBe("set_id,card_id,quantity,scanned_at,tags\r\nS1,001,1,2026-09-29T10:00:00.000Z,\r\n");
  });

  it("leaves the cells blank for a card whose game lacks them when others have them", () => {
    const csv = scannedCardsCsv([card({ gameId: "full", foil: true }), card({ gameId: "plain" })], GAMES);
    expect(csv.split("\r\n")[2]).toBe("S1,001,,,1,2026-09-29T10:00:00.000Z,");
  });

  it("leaves the orientation blank for an entry saved before it was recorded", () => {
    const csv = scannedCardsCsv([card({ orientation: null })], GAMES);
    expect(csv.split("\r\n")[1]).toBe("S1,001,false,,1,2026-09-29T10:00:00.000Z,");
  });

  it("throws for a card of a game that isn't bundled", () => {
    expect(() => scannedCardsCsv([card({ gameId: "gone" })], GAMES)).toThrow(/isn't bundled/);
  });
});

describe("mergeDuplicates", () => {
  it("sums duplicates into the most recent entry, keeping its place and timestamp", () => {
    const newest = card({ cardId: "001", quantity: 1, scannedAt: "2026-09-29T12:00:00.000Z" });
    const other = card({ cardId: "002" });
    const oldest = card({ cardId: "001", quantity: 2, scannedAt: "2026-09-29T08:00:00.000Z" });
    expect(mergeDuplicates([newest, other, oldest])).toEqual([{ ...newest, quantity: 3 }, other]);
  });

  it("treats tags in a different order as the same", () => {
    expect(mergeDuplicates([card({ tags: ["#a", "#b"] }), card({ tags: ["#b", "#a"] })])).toHaveLength(1);
  });

  it("keeps entries apart that differ in game, set, number, foil, orientation or tags", () => {
    const base = card({});
    const variants = [
      card({ gameId: "plain" }),
      card({ setCode: "S2" }),
      card({ cardId: "002" }),
      card({ foil: true }),
      card({ orientation: "landscape" }),
      card({ tags: ["#box-02"] }),
    ];
    expect(mergeDuplicates([base, ...variants])).toEqual([base, ...variants]);
  });

  it("returns the same entries when there are no duplicates", () => {
    const cards = [card({ cardId: "001" }), card({ cardId: "002" })];
    expect(mergeDuplicates(cards)).toEqual(cards);
  });
});

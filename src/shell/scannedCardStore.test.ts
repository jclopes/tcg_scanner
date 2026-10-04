import { describe, expect, it } from "vitest";
import type { GameOption } from "./gameConfig";
import { mergeDuplicates, parseScannedCards, scannedCardsCsv } from "./scannedCardStore";
import type { ScannedCard } from "./scannedCardStore";

function game(id: string, hasFoil: boolean, cardOrientations: GameOption["cardOrientations"]): GameOption {
  return { id, config: { game: id, regions: {} }, sets: [], cardOrientations, hasFoil };
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

describe("parseScannedCards", () => {
  it("returns the stored list, keeping duplicates as separate entries", () => {
    const cards = [card({ foil: true, quantity: 3, tags: ["#box-01"] }), card({ orientation: "landscape" })];
    expect(parseScannedCards(JSON.stringify(cards))).toEqual(cards);
  });

  it("throws, naming the entry and field, for a stored value that isn't a list of cards", () => {
    const valid = card({});
    for (const [stored, field] of [
      [{ setCode: "S1" }, /must be a list/],
      [[{ ...valid, gameId: undefined }], /entry 1: "gameId"/],
      [[{ ...valid, scannedAt: undefined }], /entry 1: "scannedAt"/],
      [[{ ...valid, tags: "#box-01" }], /"tags"/],
      [[{ ...valid, tags: [1] }], /"tags"/],
      [[{ ...valid, foil: "yes" }], /"foil"/],
      [[{ ...valid, orientation: "square" }], /"orientation"/],
      [[{ ...valid, quantity: 0 }], /"quantity"/],
      [[valid, { ...valid, quantity: 1.5 }], /entry 2: "quantity"/],
    ] as const) {
      expect(() => parseScannedCards(JSON.stringify(stored))).toThrow(field);
    }
  });
});

describe("scannedCardsCsv", () => {
  it("includes foil and orientation when the cards' game has them", () => {
    const csv = scannedCardsCsv(
      [card({ foil: true, orientation: "landscape", quantity: 2, tags: ["#a", "#b"] })],
      GAMES,
    );
    expect(csv).toBe(
      "set,card_number,foil,orientation,quantity,scanned_at,tags\r\nS1,001,true,landscape,2,2026-09-29T10:00:00.000Z,#a #b\r\n",
    );
  });

  it("leaves out foil and orientation when no card's game has them", () => {
    const csv = scannedCardsCsv([card({ gameId: "plain", foil: false })], GAMES);
    expect(csv).toBe("set,card_number,quantity,scanned_at,tags\r\nS1,001,1,2026-09-29T10:00:00.000Z,\r\n");
  });

  it("leaves the cells blank for a card whose game lacks them when others have them", () => {
    const csv = scannedCardsCsv([card({ gameId: "full", foil: true }), card({ gameId: "plain" })], GAMES);
    expect(csv.split("\r\n")[2]).toBe("S1,001,,,1,2026-09-29T10:00:00.000Z,");
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
});

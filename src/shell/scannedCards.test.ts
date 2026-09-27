import { describe, expect, it } from "vitest";
import { parseScannedCards } from "./scannedCards";

describe("parseScannedCards", () => {
  it("returns the stored list, keeping duplicates as separate entries", () => {
    const cards = [
      { setCode: "PRM01", cardId: "005", foil: true, scannedAt: "2026-09-27T10:00:01.000Z", tags: ["#box-01"] },
      { setCode: "PRM01", cardId: "005", foil: false, scannedAt: "2026-09-27T10:00:00.000Z", tags: [] },
    ];
    expect(parseScannedCards(JSON.stringify(cards))).toEqual(cards);
  });

  it("gives entries saved before tags and foil existed no tags and not foil", () => {
    const stored = [{ setCode: "PRM01", cardId: "005", scannedAt: "2026-09-27T10:00:00.000Z" }];
    expect(parseScannedCards(JSON.stringify(stored))).toEqual([{ ...stored[0], tags: [], foil: false }]);
  });

  it("returns an empty list for an empty stored list", () => {
    expect(parseScannedCards("[]")).toEqual([]);
  });

  it("throws for a stored value that isn't a list of cards", () => {
    expect(() => parseScannedCards('{"setCode":"PRM01"}')).toThrow(/corrupted/);
    expect(() => parseScannedCards('[{"setCode":"PRM01","cardId":"005"}]')).toThrow(/corrupted/);
    expect(() =>
      parseScannedCards('[{"setCode":"PRM01","cardId":"005","scannedAt":"2026-09-27T10:00:00.000Z","tags":"#box-01"}]'),
    ).toThrow(/corrupted/);
    expect(() =>
      parseScannedCards('[{"setCode":"PRM01","cardId":"005","scannedAt":"2026-09-27T10:00:00.000Z","foil":"yes"}]'),
    ).toThrow(/corrupted/);
  });

  it("throws for invalid JSON", () => {
    expect(() => parseScannedCards("not json")).toThrow();
  });
});

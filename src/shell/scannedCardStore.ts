import { formatCsv, requireArray, requireBoolean, requireList, requireNumber, requireRecord, requireString } from "../core";
import type { CardOrientation } from "../core";
import type { GameOption } from "./gameConfig";

/** One card the user accepted: its game (folder id), the set's code (the Set
 * dropdown's value), the card's collector number, whether it's the foil
 * version, its orientation, how many copies, when it was accepted (ISO 8601,
 * UTC) and the session tags active then (e.g. "#box-01"). Scanning the same
 * card again adds a separate entry. */
export interface ScannedCard {
  gameId: string;
  setCode: string;
  cardId: string;
  foil: boolean;
  /** null for entries saved before orientation was recorded. */
  orientation: CardOrientation | null;
  /** A positive integer. */
  quantity: number;
  scannedAt: string;
  tags: string[];
}

const STORAGE_KEY = "tcg-scanner:scanned-cards";

/** The saved list, most recent first (empty if nothing is saved). Entries
 * saved before games were recorded get their game from their set code.
 * Throws if the saved list is corrupted or names an unknown set. */
export function loadScannedCards(games: readonly GameOption[]): ScannedCard[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? [] : parseScannedCards(stored, (setCode) => gameIdOfSet(setCode, games));
}

export function saveScannedCards(cards: readonly ScannedCard[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

/** Which optional attributes apply to `card`: foil if its game has foils,
 * orientation if its game has more than one. Throws for an unknown game. */
export function cardAttributes(
  card: ScannedCard,
  games: readonly GameOption[],
): { hasFoil: boolean; hasOrientation: boolean } {
  const game = games.find((g) => g.id === card.gameId);
  if (!game) {
    throw new Error(`Scanned card ${card.cardId} belongs to game "${card.gameId}", which isn't bundled.`);
  }
  return { hasFoil: game.hasFoil, hasOrientation: game.cardOrientations.length > 1 };
}

/**
 * `cards` with duplicates merged: entries of the same card — game, set,
 * number, foil, orientation and tags (in any order) — become one whose
 * quantity is their total. The merged entry keeps the most recent one's place
 * and timestamp (`cards` is most recent first).
 */
export function mergeDuplicates(cards: readonly ScannedCard[]): ScannedCard[] {
  const merged = new Map<string, ScannedCard>();
  for (const card of cards) {
    const key = JSON.stringify([card.gameId, card.setCode, card.cardId, card.foil, card.orientation, [...card.tags].sort()]);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + card.quantity } : card);
  }
  return [...merged.values()];
}

/**
 * `cards` as CSV: set_id, card_id, then foil and orientation only if some
 * card's game has them (see cardAttributes; blank for a card whose game
 * doesn't), then quantity, scanned_at and tags.
 */
export function scannedCardsCsv(cards: readonly ScannedCard[], games: readonly GameOption[]): string {
  const attributes = cards.map((card) => cardAttributes(card, games));
  const withFoil = attributes.some((a) => a.hasFoil);
  const withOrientation = attributes.some((a) => a.hasOrientation);
  const header = [
    "set",
    "card_number",
    ...(withFoil ? ["foil"] : []),
    ...(withOrientation ? ["orientation"] : []),
    "quantity",
    "scanned_at",
    "tags",
  ];
  const rows = cards.map((card, i) => {
    const { hasFoil, hasOrientation } = attributes[i]!;
    return [
      card.setCode,
      card.cardId,
      ...(withFoil ? [hasFoil ? String(card.foil) : ""] : []),
      ...(withOrientation ? [hasOrientation ? (card.orientation ?? "") : ""] : []),
      String(card.quantity),
      card.scannedAt,
      card.tags.join(" "),
    ];
  });
  return formatCsv(header, rows);
}

/**
 * The stored JSON list. Older entries lack later fields and get: the game
 * from `gameIdForSet`, not foil, no recorded orientation, one copy, no tags.
 * Throws, naming the entry and field, if it isn't a list of scanned cards.
 */
export function parseScannedCards(json: string, gameIdForSet: (setCode: string) => string): ScannedCard[] {
  const context = `The saved scanned-card list (localStorage "${STORAGE_KEY}")`;
  return requireList(JSON.parse(json), context).map((raw, i) => parseStoredCard(raw, `${context}, entry ${i + 1}`, gameIdForSet));
}

function parseStoredCard(raw: unknown, context: string, gameIdForSet: (setCode: string) => string): ScannedCard {
  const card = requireRecord(raw, context);
  const setCode = requireString(card, "setCode", context);
  return {
    gameId: card.gameId === undefined ? gameIdForSet(setCode) : requireString(card, "gameId", context),
    setCode,
    cardId: requireString(card, "cardId", context),
    foil: card.foil === undefined ? false : requireBoolean(card, "foil", context),
    orientation: parseOrientation(card.orientation, context),
    quantity: card.quantity === undefined ? 1 : requireQuantity(card, context),
    scannedAt: requireString(card, "scannedAt", context),
    tags: card.tags === undefined ? [] : requireTags(card, context),
  };
}

function parseOrientation(value: unknown, context: string): CardOrientation | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== "portrait" && value !== "landscape") {
    throw new Error(`${context}: "orientation" must be "portrait" or "landscape", got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireQuantity(card: Record<string, unknown>, context: string): number {
  const quantity = requireNumber(card, "quantity", context);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`${context}: "quantity" must be a whole number of at least 1, got ${quantity}.`);
  }
  return quantity;
}

/** A (possibly empty) list of strings. */
function requireTags(card: Record<string, unknown>, context: string): string[] {
  const tags = requireArray(card, "tags", context);
  if (!tags.every((tag) => typeof tag === "string")) {
    throw new Error(`${context}: "tags" must be a list of strings, got ${JSON.stringify(tags)}.`);
  }
  return tags as string[];
}

/** The game owning set `setCode`. Throws if no bundled game has it. */
function gameIdOfSet(setCode: string, games: readonly GameOption[]): string {
  const game = games.find((g) => g.sets.some((set) => set.code === setCode));
  if (!game) {
    throw new Error(`Saved scanned card has set "${setCode}", which no bundled game has.`);
  }
  return game.id;
}

import { formatCsv, requireArray, requireBoolean, requireList, requireNumber, requireRecord, requireString } from "../core";
import type { CardOrientation } from "../core";
import type { GameOption } from "./gameConfig";

/** One accepted card; scanning the same card again adds a separate entry.
 * `scannedAt` is ISO 8601 (UTC); `tags` are the session tags at the time. */
export interface ScannedCard {
  gameId: string;
  setCode: string;
  cardId: string;
  foil: boolean;
  orientation: CardOrientation;
  /** A positive integer. */
  quantity: number;
  scannedAt: string;
  tags: string[];
}

const STORAGE_KEY = "tcg-scanner:scanned-cards";

/** The saved list's JSON, or null when nothing is saved. Throws when the
 * browser's storage is unavailable. */
export function readStoredScannedCards(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Throws when the browser's storage is unavailable or full. */
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

/** `cards` with entries of the same card (game, set, number, foil,
 * orientation, tags in any order) merged into the most recent, quantities
 * summed. */
export function mergeDuplicates(cards: readonly ScannedCard[]): ScannedCard[] {
  const merged = new Map<string, ScannedCard>();
  for (const card of cards) {
    const key = JSON.stringify([card.gameId, card.setCode, card.cardId, card.foil, card.orientation, [...card.tags].sort()]);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + card.quantity } : card);
  }
  return [...merged.values()];
}

/** `cards` as CSV; the foil and orientation columns only appear when some
 * card's game has them. */
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
      ...(withOrientation ? [hasOrientation ? card.orientation : ""] : []),
      String(card.quantity),
      card.scannedAt,
      card.tags.join(" "),
    ];
  });
  return formatCsv(header, rows);
}

/** The saved JSON list. Throws, naming the entry and field, if it isn't a
 * list of scanned cards. */
export function parseScannedCards(json: string): ScannedCard[] {
  const context = `The saved scanned-card list (localStorage "${STORAGE_KEY}")`;
  return requireList(JSON.parse(json), context).map((raw, i) => parseStoredCard(raw, `${context}, entry ${i + 1}`));
}

function parseStoredCard(raw: unknown, context: string): ScannedCard {
  const card = requireRecord(raw, context);
  return {
    gameId: requireString(card, "gameId", context),
    setCode: requireString(card, "setCode", context),
    cardId: requireString(card, "cardId", context),
    foil: requireBoolean(card, "foil", context),
    orientation: requireOrientation(card, context),
    quantity: requireQuantity(card, context),
    scannedAt: requireString(card, "scannedAt", context),
    tags: requireTags(card, context),
  };
}

function requireOrientation(card: Record<string, unknown>, context: string): CardOrientation {
  const orientation = requireString(card, "orientation", context);
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error(`${context}: "orientation" must be "portrait" or "landscape", got "${orientation}".`);
  }
  return orientation;
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

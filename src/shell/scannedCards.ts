import { formatCsv } from "../core";
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
const CSV_FILENAME = "scanned-cards.csv";

/**
 * The "Scanned cards" section: accepted cards, most recent first, saved in
 * localStorage until the user clears them, with a CSV download. Each row
 * shows the card and set and expands to its details and a quantity with
 * +/− buttons; − at a quantity of 1 deletes the entry. Foil and
 * orientation are shown (and exported) only for a card whose game has foils
 * or more than one orientation (see cardAttributes). Storage failures, a
 * corrupted stored list and cards of an unknown game throw rather than
 * silently dropping the user's cards.
 */
export class ScannedCardList {
  /** Most recent first. */
  private cards: ScannedCard[];

  constructor(
    private readonly games: readonly GameOption[],
    private readonly list: HTMLOListElement,
    private readonly count: HTMLElement,
    private readonly emptyNote: HTMLElement,
    private readonly downloadButton: HTMLButtonElement,
    private readonly mergeButton: HTMLButtonElement,
    private readonly clearButton: HTMLButtonElement,
  ) {
    this.cards = loadScannedCards(games);
    downloadButton.addEventListener("click", () => this.download());
    mergeButton.addEventListener("click", () => this.update(mergeDuplicates(this.cards)));
    clearButton.addEventListener("click", () => this.confirmClear());
    this.render();
  }

  /** Adds a new entry of one copy, timestamped now. */
  add(card: Omit<ScannedCard, "scannedAt" | "quantity">): void {
    this.update([{ ...card, tags: [...card.tags], quantity: 1, scannedAt: new Date().toISOString() }, ...this.cards]);
  }

  /** Replaces the list, saves it and re-renders, keeping the row at
   * `openIndex` (if any) expanded. */
  private update(cards: ScannedCard[], openIndex?: number): void {
    this.cards = cards;
    saveScannedCards(this.cards);
    this.render(openIndex);
  }

  /** Changes entry `index`'s quantity by `delta`; at zero the entry is
   * deleted. */
  private changeQuantity(index: number, delta: 1 | -1): void {
    const card = this.cards[index];
    if (!card) {
      throw new Error(`No scanned card at index ${index}.`);
    }
    const quantity = card.quantity + delta;
    if (quantity === 0) {
      this.update(this.cards.filter((_, i) => i !== index));
      return;
    }
    this.update(
      this.cards.map((c, i) => (i === index ? { ...c, quantity } : c)),
      index,
    );
  }

  private confirmClear(): void {
    if (window.confirm(`Clear all ${this.cards.length} scanned cards? This can't be undone.`)) {
      this.update([]);
    }
  }

  private render(openIndex?: number): void {
    this.list.replaceChildren(...this.cards.map((card, index) => this.row(card, index, index === openIndex)));
    this.count.textContent = String(this.cards.reduce((total, card) => total + card.quantity, 0));
    const empty = this.cards.length === 0;
    this.emptyNote.hidden = !empty;
    this.downloadButton.disabled = empty;
    this.mergeButton.disabled = mergeDuplicates(this.cards).length === this.cards.length;
    this.clearButton.disabled = empty;
  }

  /** A row: the card and set (plus "foil" if it applies, and "×N" for more
   * than one copy); expanding shows its details and the quantity controls. */
  private row(card: ScannedCard, index: number, open: boolean): HTMLLIElement {
    const { hasFoil, hasOrientation } = cardAttributes(card, this.games);

    const summary = document.createElement("summary");
    summary.textContent = [
      card.cardId,
      card.setCode,
      ...(hasFoil && card.foil ? ["foil"] : []),
      ...(card.quantity > 1 ? [`×${card.quantity}`] : []),
    ].join(" · ");

    const facts = document.createElement("dl");
    facts.className = "scanned-card-facts";
    if (hasFoil) {
      facts.append(...fact("Foil", card.foil ? "yes" : "no"));
    }
    if (hasOrientation) {
      facts.append(...fact("Orientation", card.orientation ?? "—"));
    }
    facts.append(
      ...fact("Scanned", new Date(card.scannedAt).toLocaleString()),
      ...fact("Tags", card.tags.length > 0 ? card.tags.join(" ") : "—"),
    );

    const quantity = document.createElement("output");
    quantity.className = "scanned-card-quantity";
    quantity.textContent = String(card.quantity);
    const decrease = actionButton("−", "secondary-button", () => this.changeQuantity(index, -1));
    decrease.setAttribute("aria-label", card.quantity === 1 ? "Remove this card" : "One fewer");
    decrease.classList.toggle("danger-button", card.quantity === 1);
    const increase = actionButton("+", "secondary-button", () => this.changeQuantity(index, 1));
    increase.setAttribute("aria-label", "One more");

    const actions = document.createElement("div");
    actions.className = "scanned-card-actions";
    actions.append(decrease, quantity, increase);

    const details = document.createElement("details");
    details.open = open;
    details.append(summary, facts, actions);
    const li = document.createElement("li");
    li.append(details);
    return li;
  }

  private download(): void {
    const csv = scannedCardsCsv(this.cards, this.games);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = CSV_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  }
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
    "set_id",
    "card_id",
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

/** A `<dt>`/`<dd>` pair. */
function fact(label: string, value: string): [HTMLElement, HTMLElement] {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  return [dt, dd];
}

function actionButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function loadScannedCards(games: readonly GameOption[]): ScannedCard[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? [] : parseScannedCards(stored, (setCode) => gameIdOfSet(setCode, games));
}

function saveScannedCards(cards: readonly ScannedCard[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

/** The game owning set `setCode`. Throws if no bundled game has it. */
function gameIdOfSet(setCode: string, games: readonly GameOption[]): string {
  const game = games.find((g) => g.sets.some((set) => set.code === setCode));
  if (!game) {
    throw new Error(`Saved scanned card has set "${setCode}", which no bundled game has.`);
  }
  return game.id;
}

/** A stored entry. Older entries lack later fields: no tags, not foil, no
 * recorded orientation, one copy, and a game found from their set code. */
type StoredScannedCard = Pick<ScannedCard, "setCode" | "cardId" | "scannedAt"> &
  Partial<Pick<ScannedCard, "gameId" | "foil" | "orientation" | "quantity" | "tags">>;

/** The stored JSON list; `gameIdForSet` supplies the game of entries saved
 * before games were recorded. Throws if it isn't a list of scanned cards. */
export function parseScannedCards(json: string, gameIdForSet: (setCode: string) => string): ScannedCard[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every(isStoredScannedCard)) {
    throw new Error(`The saved scanned-card list (localStorage "${STORAGE_KEY}") is corrupted.`);
  }
  return parsed.map((card) => ({
    gameId: card.gameId ?? gameIdForSet(card.setCode),
    setCode: card.setCode,
    cardId: card.cardId,
    foil: card.foil ?? false,
    orientation: card.orientation ?? null,
    quantity: card.quantity ?? 1,
    scannedAt: card.scannedAt,
    tags: card.tags ?? [],
  }));
}

function isStoredScannedCard(value: unknown): value is StoredScannedCard {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { gameId, setCode, cardId, scannedAt, tags, foil, orientation, quantity } = value as Record<string, unknown>;
  return (
    typeof setCode === "string" &&
    typeof cardId === "string" &&
    typeof scannedAt === "string" &&
    (gameId === undefined || typeof gameId === "string") &&
    (foil === undefined || typeof foil === "boolean") &&
    (quantity === undefined || (typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0)) &&
    (orientation === undefined || orientation === null || orientation === "portrait" || orientation === "landscape") &&
    (tags === undefined || (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")))
  );
}

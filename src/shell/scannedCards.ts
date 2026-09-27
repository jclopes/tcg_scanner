import { formatCsv } from "../core";

/** One card the user accepted: the set's code (the Set dropdown's value), the
 * card's collector number, whether it's the foil version, when it was
 * accepted (ISO 8601, UTC) and the session tags active then (e.g. "#box-01").
 * Scanning the same card again adds a separate entry. */
export interface ScannedCard {
  setCode: string;
  cardId: string;
  foil: boolean;
  scannedAt: string;
  tags: string[];
}

const STORAGE_KEY = "tcg-scanner:scanned-cards";
const CSV_HEADER = ["set_id", "card_id", "foil", "scanned_at", "tags"] as const;
const CSV_FILENAME = "scanned-cards.csv";

/**
 * The "Scanned cards" section: accepted cards, most recent first, saved in
 * localStorage until the user clears them, with a CSV download. Each row
 * shows the card and set and expands to its time and tags, with buttons to
 * clone it (a new entry of the same card, timestamped now) or delete it.
 * Storage failures and a corrupted stored list throw rather than silently
 * dropping the user's cards.
 */
export class ScannedCardList {
  /** Most recent first. */
  private cards: ScannedCard[] = loadScannedCards();

  constructor(
    private readonly list: HTMLOListElement,
    private readonly emptyNote: HTMLElement,
    private readonly downloadButton: HTMLButtonElement,
    private readonly clearButton: HTMLButtonElement,
  ) {
    downloadButton.addEventListener("click", () => this.download());
    clearButton.addEventListener("click", () => this.confirmClear());
    this.render();
  }

  add(setCode: string, cardId: string, foil: boolean, tags: readonly string[]): void {
    this.update([{ setCode, cardId, foil, scannedAt: new Date().toISOString(), tags: [...tags] }, ...this.cards]);
  }

  /** Replaces the list, saves it and re-renders. */
  private update(cards: ScannedCard[]): void {
    this.cards = cards;
    saveScannedCards(this.cards);
    this.render();
  }

  private clone(card: ScannedCard): void {
    this.add(card.setCode, card.cardId, card.foil, card.tags);
  }

  private delete(index: number): void {
    this.update(this.cards.filter((_, i) => i !== index));
  }

  private confirmClear(): void {
    if (window.confirm(`Clear all ${this.cards.length} scanned cards? This can't be undone.`)) {
      this.update([]);
    }
  }

  private render(): void {
    this.list.replaceChildren(...this.cards.map((card, index) => this.row(card, index)));
    const empty = this.cards.length === 0;
    this.emptyNote.hidden = !empty;
    this.downloadButton.disabled = empty;
    this.clearButton.disabled = empty;
  }

  /** A collapsed row: the card and set; expanding shows time, tags and the
   * Clone/Delete buttons. */
  private row(card: ScannedCard, index: number): HTMLLIElement {
    const summary = document.createElement("summary");
    summary.textContent = `${card.cardId} · ${card.setCode}${card.foil ? " · foil" : ""}`;

    const facts = document.createElement("dl");
    facts.className = "scanned-card-facts";
    facts.append(
      ...fact("Foil", card.foil ? "yes" : "no"),
      ...fact("Scanned", new Date(card.scannedAt).toLocaleString()),
      ...fact("Tags", card.tags.length > 0 ? card.tags.join(" ") : "—"),
    );

    const actions = document.createElement("div");
    actions.className = "scanned-card-actions";
    actions.append(
      actionButton("Clone", "secondary-button", () => this.clone(card)),
      actionButton("Delete", "secondary-button danger-button", () => this.delete(index)),
    );

    const details = document.createElement("details");
    details.append(summary, facts, actions);
    const li = document.createElement("li");
    li.append(details);
    return li;
  }

  private download(): void {
    const csv = formatCsv(
      CSV_HEADER,
      this.cards.map((card) => [card.setCode, card.cardId, String(card.foil), card.scannedAt, card.tags.join(" ")]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = CSV_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  }
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

function loadScannedCards(): ScannedCard[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? [] : parseScannedCards(stored);
}

function saveScannedCards(cards: readonly ScannedCard[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

/** A stored entry; entries saved before tags or foil existed have no tags
 * and aren't foil. */
type StoredScannedCard = Omit<ScannedCard, "tags" | "foil"> & { tags?: string[]; foil?: boolean };

/** The stored JSON list. Throws if it isn't a list of scanned cards. */
export function parseScannedCards(json: string): ScannedCard[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every(isStoredScannedCard)) {
    throw new Error(`The saved scanned-card list (localStorage "${STORAGE_KEY}") is corrupted.`);
  }
  return parsed.map((card) => ({ ...card, tags: card.tags ?? [], foil: card.foil ?? false }));
}

function isStoredScannedCard(value: unknown): value is StoredScannedCard {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { setCode, cardId, scannedAt, tags, foil } = value as Record<string, unknown>;
  return (
    typeof setCode === "string" &&
    typeof cardId === "string" &&
    typeof scannedAt === "string" &&
    (foil === undefined || typeof foil === "boolean") &&
    (tags === undefined || (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")))
  );
}

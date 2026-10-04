import type { GameOption } from "./gameConfig";
import {
  cardAttributes,
  mergeDuplicates,
  parseScannedCards,
  readStoredScannedCards,
  saveScannedCards,
  scannedCardsCsv,
} from "./scannedCardStore";
import type { ScannedCard } from "./scannedCardStore";

const CSV_FILENAME = "scanned-cards.csv";

const STORAGE_ERROR = "Scanned cards can't be saved: the browser's storage is unavailable or full. Download the CSV to keep them.";

export interface ScannedCardListElements {
  list: HTMLOListElement;
  /** The total-cards count next to the heading. */
  count: HTMLElement;
  emptyNote: HTMLElement;
  /** Shown while the list can't be saved. */
  storageError: HTMLElement;
  downloadButton: HTMLButtonElement;
  mergeButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
}

/** The "Scanned cards" section: accepted cards, most recent first, with CSV
 * download, duplicate merging and quantity controls (− at 1 deletes). */
export class ScannedCardList {
  /** Most recent first. */
  private cards: ScannedCard[];

  constructor(
    private readonly games: readonly GameOption[],
    private readonly elements: ScannedCardListElements,
  ) {
    this.cards = this.loadCards();
    elements.downloadButton.addEventListener("click", () => this.download());
    elements.mergeButton.addEventListener("click", () => this.update(mergeDuplicates(this.cards)));
    elements.clearButton.addEventListener("click", () => this.confirmClear());
    this.render();
  }

  /** Adds a new entry of one copy, timestamped now. */
  add(card: Omit<ScannedCard, "scannedAt" | "quantity">): void {
    this.update([{ ...card, tags: [...card.tags], quantity: 1, scannedAt: new Date().toISOString() }, ...this.cards]);
  }

  /** The saved list; empty, with the storage error shown, when the
   * browser's storage is unavailable. Corrupt saved data throws. */
  private loadCards(): ScannedCard[] {
    let json: string | null;
    try {
      json = readStoredScannedCards();
    } catch {
      this.showStorageError(STORAGE_ERROR);
      return [];
    }
    return json === null ? [] : parseScannedCards(json);
  }

  /** Replaces the list, saves it and re-renders, keeping the row at
   * `openIndex` (if any) expanded. A failed save keeps the list in memory and
   * shows the storage error until a save succeeds. */
  private update(cards: ScannedCard[], openIndex?: number): void {
    this.cards = cards;
    try {
      saveScannedCards(this.cards);
      this.showStorageError(null);
    } catch {
      this.showStorageError(STORAGE_ERROR);
    }
    this.render(openIndex);
  }

  private showStorageError(message: string | null): void {
    this.elements.storageError.hidden = message === null;
    this.elements.storageError.textContent = message ?? "";
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
    const { list, count, emptyNote, downloadButton, mergeButton, clearButton } = this.elements;
    list.replaceChildren(...this.cards.map((card, index) => this.row(card, index, index === openIndex)));
    count.textContent = String(this.cards.reduce((total, card) => total + card.quantity, 0));
    const empty = this.cards.length === 0;
    emptyNote.hidden = !empty;
    downloadButton.disabled = empty;
    mergeButton.disabled = mergeDuplicates(this.cards).length === this.cards.length;
    clearButton.disabled = empty;
  }

  /** A row: the card and set (plus "foil" if it applies, and "×N" for more
   * than one copy); expanding shows its details and the quantity controls. */
  private row(card: ScannedCard, index: number, open: boolean): HTMLLIElement {
    const { hasFoil, hasOrientation } = cardAttributes(card, this.games);
    const set = this.games.find((g) => g.id === card.gameId)!.sets.find((s) => s.code === card.setCode)!;

    const summary = document.createElement("summary");
    summary.textContent = [
      card.cardId,
      set.print,
      ...(hasFoil && card.foil ? ["foil"] : []),
      ...(card.quantity > 1 ? [`×${card.quantity}`] : []),
    ].join(" · ");

    const facts = document.createElement("dl");
    facts.className = "scanned-card-facts";
    if (hasFoil) {
      facts.append(...fact("Foil", card.foil ? "yes" : "no"));
    }
    if (hasOrientation) {
      facts.append(...fact("Orientation", card.orientation));
    }
    facts.append(
      ...fact("Scanned", new Date(card.scannedAt).toLocaleString()),
      ...fact("Tags", card.tags.length > 0 ? card.tags.join(" ") : "—"),
    );

    const quantity = document.createElement("output");
    quantity.className = "scanned-card-quantity";
    quantity.textContent = String(card.quantity);
    const decrease = actionButton("−", () => this.changeQuantity(index, -1));
    decrease.setAttribute("aria-label", card.quantity === 1 ? "Remove this card" : "One fewer");
    decrease.classList.toggle("button-danger", card.quantity === 1);
    const increase = actionButton("+", () => this.changeQuantity(index, 1));
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

/** A `<dt>`/`<dd>` pair. */
function fact(label: string, value: string): [HTMLElement, HTMLElement] {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  return [dt, dd];
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

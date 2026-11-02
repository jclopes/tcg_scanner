import { loadGame } from "./gameConfig";
import type { Game, GameOption } from "./gameConfig";
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

const STORAGE_ERROR = "Scanned cards can't be saved: the browser's storage is unavailable or full. Export them to keep a copy.";

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
  /** `games` holds every card's game, loaded: rows show their set's print. */
  private constructor(
    /** Most recent first. */
    private cards: ScannedCard[],
    private readonly games: Map<string, Game>,
    private readonly elements: ScannedCardListElements,
    storageUnavailable: boolean,
  ) {
    if (storageUnavailable) {
      this.showStorageError(STORAGE_ERROR);
    }
    elements.downloadButton.addEventListener("click", () => this.download());
    elements.mergeButton.addEventListener("click", () => this.update(mergeDuplicates(this.cards)));
    elements.clearButton.addEventListener("click", () => this.confirmClear());
    this.render();
  }

  /** The saved list, with its cards' games loaded. Empty, with the storage
   * error shown, when the browser's storage is unavailable. Corrupt saved data
   * and cards of a game that isn't bundled throw. */
  static async create(allGames: readonly GameOption[], elements: ScannedCardListElements): Promise<ScannedCardList> {
    let json: string | null = null;
    let storageUnavailable = false;
    try {
      json = readStoredScannedCards();
    } catch {
      storageUnavailable = true;
    }
    const cards = json === null ? [] : parseScannedCards(json);
    const games = new Map<string, Game>();
    for (const card of cards) {
      if (games.has(card.gameId)) {
        continue;
      }
      const game = allGames.find((g) => g.id === card.gameId);
      if (!game) {
        throw new Error(`Scanned card ${card.cardId} belongs to game "${card.gameId}", which isn't bundled.`);
      }
      games.set(card.gameId, await loadGame(game));
    }
    return new ScannedCardList(cards, games, elements, storageUnavailable);
  }

  /** Adds a new entry of one copy of `game`'s card, timestamped now. */
  add(game: Game, card: Omit<ScannedCard, "gameId" | "scannedAt" | "quantity">): void {
    this.games.set(game.id, game);
    this.update([
      { ...card, gameId: game.id, tags: [...card.tags], quantity: 1, scannedAt: new Date().toISOString() },
      ...this.cards,
    ]);
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
    const { hasFoil, hasOrientation } = cardAttributes(card, [...this.games.values()]);
    const set = this.games.get(card.gameId)!.sets.find((s) => s.code === card.setCode)!;

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
    const csv = scannedCardsCsv(this.cards, [...this.games.values()]);
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

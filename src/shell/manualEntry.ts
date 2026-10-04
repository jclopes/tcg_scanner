import { findCardId } from "../core";
import { optionElement } from "./dom";
import type { GameSet } from "./gameConfig";

export interface ManualEntryElements {
  form: HTMLFormElement;
  input: HTMLInputElement;
  suggestions: HTMLDataListElement;
  error: HTMLElement;
}

/** The "Card number" field: adds a card the scan doesn't detect by typing one
 * of the selected set's numbers. `add` returns an error message or null. */
export class ManualCardEntry {
  constructor(
    private readonly elements: ManualEntryElements,
    private readonly currentSet: () => GameSet,
    private readonly add: (set: GameSet, cardId: string) => string | null,
  ) {
    elements.input.addEventListener("focus", () => this.fillSuggestions());
    elements.input.addEventListener("input", () => this.showError(null));
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  private fillSuggestions(): void {
    this.elements.suggestions.replaceChildren(
      ...this.currentSet().collectorNumbers.map((id) => optionElement(id, id)),
    );
  }

  private submit(): void {
    const set = this.currentSet();
    const query = this.elements.input.value.trim();
    const cardId = findCardId(query, set.collectorNumbers);
    if (cardId === null) {
      this.showError(query === "" ? "Type a card number." : `${query} isn't in ${set.name}.`);
      return;
    }
    const error = this.add(set, cardId);
    this.showError(error);
    if (error === null) {
      this.elements.input.value = "";
    }
  }

  private showError(message: string | null): void {
    this.elements.error.hidden = message === null;
    this.elements.error.textContent = message ?? "";
    this.elements.input.setAttribute("aria-invalid", String(message !== null));
  }
}

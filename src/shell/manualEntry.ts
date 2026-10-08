import { findCardId } from "../core";
import { optionElement } from "./dom";
import type { GameSet, SetChoice } from "./gameConfig";

export interface ManualEntryElements {
  form: HTMLFormElement;
  input: HTMLInputElement;
  addButton: HTMLButtonElement;
  suggestions: HTMLDataListElement;
  error: HTMLElement;
  /** Shown instead of the field working while the set is on Autodetect. */
  autodetectHint: HTMLElement;
}

/** The "Card number" field: adds a card the scan doesn't detect by typing one
 * of the chosen set's numbers; disabled while the set is on Autodetect. `add`
 * returns an error message or null. */
export class ManualCardEntry {
  constructor(
    private readonly elements: ManualEntryElements,
    private setChoice: SetChoice,
    private readonly add: (set: GameSet, cardId: string) => string | null,
  ) {
    this.applySet(setChoice);
    elements.input.addEventListener("focus", () => this.fillSuggestions());
    elements.input.addEventListener("input", () => this.showError(null));
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  /** Types numbers from `setChoice`; disables the field, with a hint, under
   * Autodetect. */
  applySet(setChoice: SetChoice): void {
    this.setChoice = setChoice;
    const autodetect = setChoice === "autodetect";
    this.elements.input.disabled = autodetect;
    this.elements.addButton.disabled = autodetect;
    this.elements.autodetectHint.hidden = !autodetect;
    this.showError(null);
  }

  /** The chosen set; the field is disabled under Autodetect, so its handlers
   * never run then. */
  private get set(): GameSet {
    if (this.setChoice === "autodetect") {
      throw new Error("The card number field was used while the set is on Autodetect.");
    }
    return this.setChoice;
  }

  private fillSuggestions(): void {
    this.elements.suggestions.replaceChildren(...this.set.collectorNumbers.map((id) => optionElement(id, id)));
  }

  private submit(): void {
    const set = this.set;
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

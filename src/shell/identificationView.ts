import { closerSetPrints } from "../core";
import { optionElement } from "./dom";
import type { GameSet } from "./gameConfig";
import { suggestCardIds } from "./identify";
import type { Identification } from "./identify";

export interface IdentificationViewElements {
  warning: HTMLElement;
  /** The set dropdown's row, which keeps its space when hidden. */
  setRow: HTMLElement;
  setSelect: HTMLSelectElement;
  matches: HTMLElement;
}

/** The capture area's identification: a set dropdown, preselected with the set
 * the card was identified in, a warning when the OCR'd set code fits another
 * set better, a button per suggested card ID (`onAccept`) and Rescan
 * (`onRescan`). Picking another set suggests that set's card IDs instead. */
export class IdentificationView {
  /** The shown identification and its game's sets; null while cleared. */
  private shown: { sets: readonly GameSet[]; identification: Identification } | null = null;

  constructor(
    private readonly elements: IdentificationViewElements,
    private readonly onAccept: (set: GameSet, cardId: string) => void,
    private readonly onRescan: () => void,
  ) {
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    this.clear();
  }

  /** Shows `identification` for `set`, with `sets` (its game's) to pick from. */
  show(sets: readonly GameSet[], set: GameSet, identification: Identification): void {
    this.shown = { sets, identification };
    this.elements.setSelect.replaceChildren(...sets.map((s) => optionElement(s.code, s.name)));
    this.elements.setSelect.value = set.code;
    this.elements.setRow.hidden = false;
    this.render(sets, identification, set);
  }

  clear(): void {
    this.shown = null;
    this.elements.setRow.hidden = true;
    this.elements.setSelect.replaceChildren();
    this.showWarning(null);
    this.elements.matches.replaceChildren();
  }

  private handleSetChange(): void {
    if (this.shown === null) {
      throw new Error("The capture's set changed while no card was shown.");
    }
    const { sets, identification } = this.shown;
    const set = sets.find((s) => s.code === this.elements.setSelect.value);
    if (!set) {
      throw new Error(`Unknown set option: ${this.elements.setSelect.value}`);
    }
    this.render(sets, identification, set);
  }

  /** The warning and the match buttons for `set`. */
  private render(sets: readonly GameSet[], identification: Identification, set: GameSet): void {
    this.showWarning(setWarning(closerSetPrints(identification.setCodeText, set, sets)));
    this.elements.matches.replaceChildren(
      ...suggestCardIds(identification.collectorNumberText, set).map((match) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-outline mono";
        button.textContent = match.id;
        button.addEventListener("click", () => this.onAccept(set, match.id));
        return button;
      }),
      this.rescanButton(),
    );
  }

  private rescanButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = "Rescan";
    button.title = "None of these — scan the card again";
    button.addEventListener("click", () => this.onRescan());
    return button;
  }

  /** The warning keeps its line when hidden; a message too long for it is
   * cut off, so the full text is also its title. */
  private showWarning(message: string | null): void {
    this.elements.warning.hidden = message === null;
    this.elements.warning.textContent = message ?? "";
    this.elements.warning.title = message ?? "";
  }
}

/** E.g. "Set may be The Heist — Retail Starter Deck (SD01 - HEI [A])", or
 * null when there's no likelier set. Sets sharing a printed code are listed
 * together. */
function setWarning(closerSets: readonly GameSet[]): string | null {
  const first = closerSets[0];
  if (!first) {
    return null;
  }
  return `Set may be ${closerSets.map((set) => set.name).join(" or ")} (${first.print})`;
}

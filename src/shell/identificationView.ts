import { closerSetPrints } from "../core";
import type { CardIdMatch } from "../core";
import { optionElement } from "./dom";
import type { GameSet } from "./gameConfig";
import { suggestCardIds } from "./identify";
import type { Identification } from "./identify";

export interface IdentificationViewElements {
  warning: HTMLElement;
  /** The set dropdown's row, which keeps its space when hidden. */
  setRow: HTMLElement;
  setSelect: HTMLSelectElement;
  /** Tesseract's own confidence in the collector-number reading — the same
   * value regardless of which match is picked, so shown once, not per button. */
  confidence: HTMLElement;
  matches: HTMLElement;
}

/** The capture area's identification: a set dropdown, preselected with the set
 * the card was identified in, a warning when the OCR'd set code fits another
 * set better, a button per suggested card ID (`onAccept`) and Rescan
 * (`onRescan`). Picking another set suggests that set's card IDs instead.
 * While shown, number keys 1-3 accept the matching button and Escape rescans
 * — unless a form field has focus. */
export class IdentificationView {
  /** The shown identification and its game's sets; null while cleared. */
  private shown: { sets: readonly GameSet[]; identification: Identification } | null = null;
  /** The set and matches last rendered, for the number-key shortcuts; null
   * while cleared. */
  private rendered: { set: GameSet; matches: readonly CardIdMatch[] } | null = null;

  constructor(
    private readonly elements: IdentificationViewElements,
    private readonly onAccept: (set: GameSet, cardId: string) => void,
    private readonly onRescan: () => void,
  ) {
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.clear();
  }

  /** Shows `identification` for `set`, with `sets` (its game's) to pick from. */
  show(sets: readonly GameSet[], set: GameSet, identification: Identification): void {
    this.shown = { sets, identification };
    this.elements.setSelect.replaceChildren(...sets.map((s) => optionElement(s.code, s.name)));
    this.elements.setSelect.value = set.code;
    this.elements.setRow.hidden = false;
    this.elements.confidence.hidden = false;
    this.elements.confidence.textContent = `OCR confidence: ${Math.round(identification.collectorNumberConfidence)}%`;
    this.render(sets, identification, set);
  }

  clear(): void {
    this.shown = null;
    this.rendered = null;
    this.elements.setRow.hidden = true;
    this.elements.setSelect.replaceChildren();
    this.elements.confidence.hidden = true;
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
    const matches = suggestCardIds(identification.collectorNumberText, set);
    this.rendered = { set, matches };
    this.elements.matches.replaceChildren(
      ...matches.map((match, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-outline mono";
        button.textContent = match.id;
        button.title = `${match.id} (${index + 1})`;
        button.addEventListener("click", () => this.onAccept(set, match.id));
        return button;
      }),
      this.rescanButton(),
    );
  }

  /** Number keys 1-3 accept the matching button, Escape rescans — ignored
   * while nothing is shown or a form field has focus. */
  private handleKeydown(event: KeyboardEvent): void {
    if (this.rendered === null || isEditableTarget(event.target)) {
      return;
    }
    if (event.key === "Escape") {
      this.onRescan();
      return;
    }
    const index = Number(event.key) - 1;
    const match = this.rendered.matches[index];
    if (match) {
      this.onAccept(this.rendered.set, match.id);
    }
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

/** Whether `target` is a form field that should keep typed digits (e.g. the
 * manual card number field) from being read as match shortcuts. */
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
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

import type { GameSet } from "./gameConfig";
import type { Identification } from "./identify";

/** The capture area's identification: a warning when the OCR'd set code fits
 * another set better, a button per suggested card ID (`onAccept`) and Rescan
 * (`onRescan`). */
export class IdentificationView {
  constructor(
    private readonly warning: HTMLElement,
    private readonly matches: HTMLElement,
    private readonly onAccept: (set: GameSet, cardId: string) => void,
    private readonly onRescan: () => void,
  ) {
    this.clear();
  }

  show(set: GameSet, identification: Identification): void {
    this.showWarning(setWarning(identification.setCode.closerSets));
    this.matches.replaceChildren(
      ...identification.matches.map((match) => {
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

  clear(): void {
    this.showWarning(null);
    this.matches.replaceChildren();
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
    this.warning.hidden = message === null;
    this.warning.textContent = message ?? "";
    this.warning.title = message ?? "";
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

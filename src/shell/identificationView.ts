import type { GameSet } from "./gameConfig";
import type { Identification } from "./identify";

/** The Identification section: status line plus one row per OCR'd region
 * and a "Best matches" row of buttons, with a warning when the OCR'd set code
 * doesn't match the selected set's printed code, one per suggested card ID, closest
 * match first. Clicking one accepts that card (`onAccept`). */
export class IdentificationView {
  constructor(
    private readonly section: HTMLElement,
    private readonly status: HTMLElement,
    private readonly warning: HTMLElement,
    private readonly results: HTMLDListElement,
    private readonly onAccept: (set: GameSet, cardId: string) => void,
  ) {}

  showPending(): void {
    this.section.hidden = false;
    this.status.textContent = "Identifying…";
    this.showWarning(null);
    this.results.replaceChildren();
  }

  show(game: string, set: GameSet, identification: Identification): void {
    this.section.hidden = false;
    this.status.textContent = `Game: ${game} · Set: ${set.name}`;
    const { text, matchesSet } = identification.setCode;
    this.showWarning(
      matchesSet ? null : `Set code reads "${text || "nothing"}", but ${set.name} prints "${set.print}". Check the Set selection.`,
    );
    this.results.replaceChildren();
    for (const { crop, ocr } of identification.regions) {
      if (ocr) {
        this.appendRow(crop.region.label, document.createTextNode(ocr.text || "(no text recognized)"));
      }
    }
    this.appendRow("Best matches", this.matchButtons(set, identification.matches));
  }

  clear(): void {
    this.section.hidden = true;
    this.status.textContent = "";
    this.showWarning(null);
    this.results.replaceChildren();
  }

  private showWarning(message: string | null): void {
    this.warning.hidden = message === null;
    this.warning.textContent = message ?? "";
  }

  private matchButtons(set: GameSet, matches: Identification["matches"]): HTMLElement {
    const container = document.createElement("div");
    container.className = "match-buttons";
    container.append(
      ...matches.map((match) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "match-button";
        button.textContent = match.id;
        button.addEventListener("click", () => this.onAccept(set, match.id));
        return button;
      }),
    );
    return container;
  }

  private appendRow(label: string, value: Node): void {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.append(value);
    this.results.append(dt, dd);
  }
}

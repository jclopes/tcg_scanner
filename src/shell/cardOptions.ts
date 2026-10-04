import type { CardOrientation } from "../core";
import type { GameOption } from "./gameConfig";

export interface CardOptionsElements {
  /** The Portrait/Landscape toggle and its two radio buttons. */
  orientationToggle: HTMLElement;
  orientationRadios: Record<CardOrientation, HTMLInputElement>;
  /** The Foil toggle (its label) and its checkbox. */
  foilToggle: HTMLElement;
  foilCheckbox: HTMLInputElement;
}

/** The Scan screen's card orientation and foil toggles, kept for the session
 * only. The orientation toggle shows only for a game with both orientations,
 * the foil toggle only for a game with foils. */
export class CardOptions {
  private selectedOrientation: CardOrientation;
  private selectedFoil = false;

  constructor(
    private readonly elements: CardOptionsElements,
    game: GameOption,
  ) {
    this.selectedOrientation = game.cardOrientations[0]!;
    this.applyGame(game);

    for (const [orientation, radio] of Object.entries(elements.orientationRadios) as [CardOrientation, HTMLInputElement][]) {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.selectedOrientation = orientation;
        }
      });
    }
    elements.foilCheckbox.addEventListener("change", () => {
      this.selectedFoil = elements.foilCheckbox.checked;
    });
  }

  get cardOrientation(): CardOrientation {
    return this.selectedOrientation;
  }

  /** Whether the next accepted card is foil. Always false for a game without
   * foils. */
  get foil(): boolean {
    return this.selectedFoil;
  }

  /** Fits the toggles to `game`: keeps the selected orientation if the game
   * has it (otherwise its first), and turns foil off for a game without
   * foils. */
  applyGame(game: GameOption): void {
    const { cardOrientations, hasFoil } = game;
    if (!cardOrientations.includes(this.selectedOrientation)) {
      this.selectedOrientation = cardOrientations[0]!;
    }
    this.elements.orientationRadios[this.selectedOrientation].checked = true;
    this.elements.orientationToggle.hidden = cardOrientations.length < 2;

    this.elements.foilToggle.hidden = !hasFoil;
    if (!hasFoil) {
      this.selectedFoil = false;
      this.elements.foilCheckbox.checked = false;
    }
  }
}

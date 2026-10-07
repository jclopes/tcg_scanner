import { optionElement } from "./dom";
import { listGames } from "./gameConfig";
import type { GameOption, GameSet } from "./gameConfig";
import { loadPreferences, savePreferences } from "./preferences";

export interface GameChoiceElements {
  gameSelect: HTMLSelectElement;
  setSelect: HTMLSelectElement;
  dialog: HTMLDialogElement;
  startButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
}

/** The Start Scan dialog's game and set dropdowns. The choice is saved as a
 * preference and restored when that game and set still exist. */
export class GameChoice {
  private readonly games = listGames();
  private selectedGame: GameOption;
  private selectedSet: GameSet;

  /** `onGameChange` runs after the user picks another game; `onStart` after
   * the user confirms the dialog. */
  constructor(
    private readonly elements: GameChoiceElements,
    private readonly onGameChange: (game: GameOption) => void,
    onStart: () => void,
  ) {
    const preferences = loadPreferences();
    elements.gameSelect.replaceChildren(...this.games.map((game) => optionElement(game.id, game.id)));
    this.selectedGame = this.games.find((game) => game.id === preferences.gameId) ?? this.games[0]!;
    elements.gameSelect.value = this.selectedGame.id;
    this.selectedSet = this.populateSets(preferences.setCode);

    elements.gameSelect.addEventListener("change", () => this.handleGameChange());
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    elements.startButton.addEventListener("click", () => {
      elements.dialog.close();
      onStart();
    });
    elements.cancelButton.addEventListener("click", () => elements.dialog.close());
  }

  /** Shows the dialog with the current choice selected. */
  open(): void {
    if (!this.elements.dialog.open) {
      this.elements.dialog.showModal();
    }
  }

  /** Every bundled game. */
  get allGames(): readonly GameOption[] {
    return this.games;
  }

  get game(): GameOption {
    return this.selectedGame;
  }

  get set(): GameSet {
    return this.selectedSet;
  }

  private save(): void {
    savePreferences({ gameId: this.selectedGame.id, setCode: this.selectedSet.code });
  }

  /** Fills the set dropdown with the selected game's sets and selects
   * `desiredCode` when the game has it, otherwise its first set. */
  private populateSets(desiredCode: string | undefined): GameSet {
    const { sets } = this.selectedGame;
    this.elements.setSelect.replaceChildren(...sets.map((set) => optionElement(set.code, set.name)));
    const set = sets.find((s) => s.code === desiredCode) ?? sets[0]!;
    this.elements.setSelect.value = set.code;
    return set;
  }

  private handleGameChange(): void {
    const game = this.games.find((g) => g.id === this.elements.gameSelect.value);
    if (!game) {
      throw new Error(`Unknown game option: ${this.elements.gameSelect.value}`);
    }
    this.selectedGame = game;
    this.selectedSet = this.populateSets(undefined);
    this.save();
    this.onGameChange(game);
  }

  private handleSetChange(): void {
    const set = this.selectedGame.sets.find((s) => s.code === this.elements.setSelect.value);
    if (!set) {
      throw new Error(`Unknown set option: ${this.elements.setSelect.value}`);
    }
    this.selectedSet = set;
    this.save();
  }
}

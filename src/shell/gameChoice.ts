import { optionElement } from "./dom";
import { listGames } from "./gameConfig";
import type { GameOption, SetChoice } from "./gameConfig";
import { loadPreferences, savePreferences } from "./preferences";

/** The set dropdown's value for Autodetect: empty, which no set code is. */
const AUTODETECT_OPTION_VALUE = "";

export interface GameChoiceElements {
  gameSelect: HTMLSelectElement;
  setSelect: HTMLSelectElement;
  dialog: HTMLDialogElement;
  startButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
}

/** The Start Scan dialog's game and set dropdowns; the set can be
 * Autodetect, the default. The choice is saved as a preference and restored
 * when that game and set still exist. */
export class GameChoice {
  private readonly games = listGames();
  private selectedGame: GameOption;
  private selectedSet: SetChoice;

  /** `onGameChange` runs after the user picks another game; `onSetChange`
   * after the set choice changes, also when a game change resets it; `onStart`
   * after the user confirms the dialog. */
  constructor(
    private readonly elements: GameChoiceElements,
    private readonly onGameChange: (game: GameOption) => void,
    private readonly onSetChange: (set: SetChoice) => void,
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

  get set(): SetChoice {
    return this.selectedSet;
  }

  /** Autodetect saves no set code, so the next launch restores the default. */
  private save(): void {
    const setCode = this.selectedSet === "autodetect" ? undefined : this.selectedSet.code;
    savePreferences({ gameId: this.selectedGame.id, setCode });
  }

  /** Fills the set dropdown with Autodetect and the selected game's sets, and
   * selects `desiredCode` when the game has it, otherwise Autodetect. */
  private populateSets(desiredCode: string | undefined): SetChoice {
    const { sets } = this.selectedGame;
    this.elements.setSelect.replaceChildren(
      optionElement(AUTODETECT_OPTION_VALUE, "Autodetect"),
      ...sets.map((set) => optionElement(set.code, set.name)),
    );
    const set: SetChoice = sets.find((s) => s.code === desiredCode) ?? "autodetect";
    this.elements.setSelect.value = set === "autodetect" ? AUTODETECT_OPTION_VALUE : set.code;
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
    this.onSetChange(this.selectedSet);
  }

  private handleSetChange(): void {
    const { value } = this.elements.setSelect;
    const set = value === AUTODETECT_OPTION_VALUE ? "autodetect" : this.selectedGame.sets.find((s) => s.code === value);
    if (!set) {
      throw new Error(`Unknown set option: ${value}`);
    }
    this.selectedSet = set;
    this.save();
    this.onSetChange(set);
  }
}

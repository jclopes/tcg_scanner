import { optionElement } from "./dom";
import { listGames, loadGame } from "./gameConfig";
import type { Game, GameOption, SetChoice } from "./gameConfig";
import { loadPreferences, savePreferences } from "./preferences";

/** The set dropdown's value for Autodetect: empty, which no set code is. */
const AUTODETECT_OPTION_VALUE = "";

export interface GameChoiceElements {
  gameSelect: HTMLSelectElement;
  setSelect: HTMLSelectElement;
  dialog: HTMLDialogElement;
  startButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  /** Shown when the picked game's sets couldn't be loaded. */
  error: HTMLElement;
}

/** The Start Scan dialog's game and set dropdowns; the set can be
 * Autodetect, the default. The choice is saved as a preference and restored
 * when that game and set still exist. */
export class GameChoice {
  private selectedGame: Game;
  private selectedSet: SetChoice;

  /** `onGameChange` runs after the user picks another game; `onSetChange`
   * after the set choice changes, also when a game change resets it; `onStart`
   * after the user confirms the dialog. */
  private constructor(
    private readonly games: readonly GameOption[],
    initial: { game: Game; setCode: string | undefined },
    private readonly elements: GameChoiceElements,
    private readonly onGameChange: (game: Game) => void,
    private readonly onSetChange: (set: SetChoice) => void,
    onStart: () => void,
  ) {
    elements.gameSelect.replaceChildren(...games.map((game) => optionElement(game.id, game.id)));
    this.selectedGame = initial.game;
    elements.gameSelect.value = this.selectedGame.id;
    this.selectedSet = this.populateSets(initial.setCode);

    elements.gameSelect.addEventListener("change", () => this.handleGameChange());
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    elements.startButton.addEventListener("click", () => {
      elements.dialog.close();
      onStart();
    });
    elements.cancelButton.addEventListener("click", () => elements.dialog.close());
  }

  /** The dialog with the saved game (else the first) loaded. See the
   * constructor for the callbacks. */
  static async create(
    elements: GameChoiceElements,
    onGameChange: (game: Game) => void,
    onSetChange: (set: SetChoice) => void,
    onStart: () => void,
  ): Promise<GameChoice> {
    const games = listGames();
    const preferences = loadPreferences();
    const game = games.find((g) => g.id === preferences.gameId) ?? games[0]!;
    const initial = { game: await loadGame(game), setCode: preferences.setCode };
    return new GameChoice(games, initial, elements, onGameChange, onSetChange, onStart);
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

  get game(): Game {
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

  /** Loads the picked game's sets with the dialog's inputs disabled, so the
   * choice can't change meanwhile. If loading fails, the previous game stays. */
  private handleGameChange(): void {
    const option = this.games.find((g) => g.id === this.elements.gameSelect.value);
    if (!option) {
      throw new Error(`Unknown game option: ${this.elements.gameSelect.value}`);
    }
    this.setInputsEnabled(false);
    loadGame(option).then(
      (game) => {
        this.setInputsEnabled(true);
        this.showError(null);
        this.selectedGame = game;
        this.selectedSet = this.populateSets(undefined);
        this.save();
        this.onGameChange(game);
        this.onSetChange(this.selectedSet);
      },
      (error: unknown) => {
        console.error(`Could not load game "${option.id}".`, error);
        this.setInputsEnabled(true);
        this.elements.gameSelect.value = this.selectedGame.id;
        this.showError(`Couldn't load ${option.id}. Check your connection and try again.`);
      },
    );
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

  private setInputsEnabled(enabled: boolean): void {
    const { gameSelect, setSelect, startButton } = this.elements;
    for (const input of [gameSelect, setSelect, startButton]) {
      input.disabled = !enabled;
    }
  }

  private showError(message: string | null): void {
    this.elements.error.hidden = message === null;
    this.elements.error.textContent = message ?? "";
  }
}

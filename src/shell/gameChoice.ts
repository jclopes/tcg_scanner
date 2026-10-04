import { optionElement } from "./dom";
import { listGames } from "./gameConfig";
import type { GameOption, GameSet } from "./gameConfig";
import { loadPreferences, savePreferences } from "./preferences";

export interface GameChoiceElements {
  gameSelect: HTMLSelectElement;
  setSelect: HTMLSelectElement;
}

/** The Game screen's game and set dropdowns. The choice is saved as a
 * preference and restored when that game and set still exist. */
export class GameChoice {
  private readonly games = listGames();
  /** Whether an earlier session saved a game choice; false on first launch. */
  readonly hasSavedGame: boolean;
  private selectedGame: GameOption;
  private selectedSet: GameSet;

  /** `onGameChange` runs after the user picks another game. */
  constructor(
    private readonly elements: GameChoiceElements,
    private readonly onGameChange: (game: GameOption) => void,
  ) {
    const preferences = loadPreferences();
    this.hasSavedGame = preferences.gameId !== undefined;
    elements.gameSelect.replaceChildren(...this.games.map((game) => optionElement(game.id, game.id)));
    this.selectedGame = this.games.find((game) => game.id === preferences.gameId) ?? this.games[0]!;
    elements.gameSelect.value = this.selectedGame.id;
    this.selectedSet = this.populateSets(preferences.setCode);

    elements.gameSelect.addEventListener("change", () => this.handleGameChange());
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
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

  /** Saves the selected game and set — also when the user kept the defaults,
   * so the next launch counts as having a saved choice. */
  save(): void {
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

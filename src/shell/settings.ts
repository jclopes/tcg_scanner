import { parseTags } from "../core";
import type { CardPrintFormat, ParsedTags, Size } from "../core";
import { listFullHdCameras } from "./cameraDevices";
import type { CameraOption } from "./cameraDevices";
import { DEFAULT_CAMERA_RESOLUTION, resolutionOptionsForCamera, SUGGESTED_SESSION_TAGS } from "./config";
import { optionElement, placeholderOption } from "./dom";
import { listGames } from "./gameConfig";
import type { GameOption, GameSet } from "./gameConfig";
import { loadPreferences, savePreferences } from "./preferences";

export interface SettingsElements {
  gameSelect: HTMLSelectElement;
  setSelect: HTMLSelectElement;
  cameraSelect: HTMLSelectElement;
  resolutionSelect: HTMLSelectElement;
  /** The Portrait/Landscape toggle and its two radio buttons. */
  formatToggle: HTMLElement;
  formatRadios: Record<CardPrintFormat, HTMLInputElement>;
  /** The Foil toggle (its label) and its checkbox. */
  foilToggle: HTMLElement;
  foilCheckbox: HTMLInputElement;
  tagsInput: HTMLInputElement;
  tagSuggestions: HTMLElement;
  tagsError: HTMLElement;
}

/**
 * The scan settings — game, set, camera, resolution, session tags, card
 * format, foil — and the current value of each. Game, set, camera,
 * resolution and tags are saved as preferences and restored when still
 * available; card format and foil are sticky for the session only. The
 * format toggle is shown only for a game with both formats, and the foil
 * toggle only for a game with foils (see GameOption).
 */
export class SettingsPanel {
  private readonly preferences = loadPreferences();
  private readonly games = listGames();
  private cameras: CameraOption[] = [];
  private selectedCamera: CameraOption | null = null;
  /** The requested resolution; the camera may negotiate a different one. */
  private selectedResolution: Size = this.preferences.resolution ?? DEFAULT_CAMERA_RESOLUTION;
  private selectedGame: GameOption;
  private selectedSet: GameSet;
  private selectedCardFormat: CardPrintFormat;
  private selectedFoil = false;
  private parsedTags: ParsedTags;

  /** `onCameraSettingsChanged` runs after the camera or resolution changes. */
  constructor(
    private readonly elements: SettingsElements,
    private readonly onCameraSettingsChanged: () => void,
  ) {
    elements.gameSelect.replaceChildren(...this.games.map((game) => optionElement(game.id, game.id)));
    this.selectedGame = this.games.find((game) => game.id === this.preferences.gameId) ?? this.games[0]!;
    elements.gameSelect.value = this.selectedGame.id;
    this.selectedSet = this.populateSets(this.preferences.setCode);
    this.selectedCardFormat = this.selectedGame.cardFormats[0]!;
    this.applyGameCardOptions();
    elements.tagsInput.value = this.preferences.sessionTags ?? "";
    this.parsedTags = this.readTags();
    elements.tagSuggestions.replaceChildren(...SUGGESTED_SESSION_TAGS.map((tag) => this.suggestionButton(tag)));

    elements.gameSelect.addEventListener("change", () => this.handleGameChange());
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    elements.cameraSelect.addEventListener("change", () => this.handleCameraChange());
    elements.resolutionSelect.addEventListener("change", () => this.handleResolutionChange());
    for (const [format, radio] of Object.entries(elements.formatRadios) as [CardPrintFormat, HTMLInputElement][]) {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.selectedCardFormat = format;
        }
      });
    }
    elements.foilCheckbox.addEventListener("change", () => {
      this.selectedFoil = elements.foilCheckbox.checked;
    });
    elements.tagsInput.addEventListener("input", () => this.handleTagsChange());
  }

  get camera(): CameraOption | null {
    return this.selectedCamera;
  }

  get resolution(): Size {
    return this.selectedResolution;
  }

  get game(): GameOption {
    return this.selectedGame;
  }

  get set(): GameSet {
    return this.selectedSet;
  }

  get cardFormat(): CardPrintFormat {
    return this.selectedCardFormat;
  }

  /** Whether the next accepted card is foil. Always false for a game
   * without foils. */
  get foil(): boolean {
    return this.selectedFoil;
  }

  /** The session tags, plus any tokens in the input that aren't valid tags. */
  get sessionTags(): ParsedTags {
    return this.parsedTags;
  }

  /** Probes cameras for Full HD support and fills the camera dropdown,
   * restoring the saved choice when it's still present. */
  async populateCameras(): Promise<void> {
    this.cameras = await listFullHdCameras();
    const { cameraSelect, resolutionSelect } = this.elements;
    if (this.cameras.length === 0) {
      cameraSelect.replaceChildren(placeholderOption("No Full HD camera found"));
      resolutionSelect.replaceChildren();
      return;
    }
    cameraSelect.replaceChildren(...this.cameras.map((camera) => optionElement(camera.deviceId, camera.label)));
    this.selectedCamera = this.cameras.find((c) => c.deviceId === this.preferences.cameraDeviceId) ?? this.cameras[0]!;
    cameraSelect.value = this.selectedCamera.deviceId;
    this.populateResolutions(this.selectedCamera);
  }

  /** Camera and resolution can't change while the camera is starting. */
  setCameraStarting(starting: boolean): void {
    this.elements.cameraSelect.disabled = starting || this.cameras.length === 0;
    this.elements.resolutionSelect.disabled = starting;
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

  /** Fills the resolution dropdown with the options `camera` supports and
   * keeps the selected resolution if it's among them, otherwise the highest. */
  private populateResolutions(camera: CameraOption): void {
    const options = resolutionOptionsForCamera(camera.maxWidth, camera.maxHeight);
    this.elements.resolutionSelect.replaceChildren(
      ...options.map((option) => optionElement(resolutionOptionValue(option.size), option.label)),
    );
    const match = options.find((option) => resolutionOptionValue(option.size) === resolutionOptionValue(this.selectedResolution));
    this.selectedResolution = (match ?? options[options.length - 1]!).size;
    this.elements.resolutionSelect.value = resolutionOptionValue(this.selectedResolution);
  }

  /** Parses the tags input and shows which tokens aren't valid tags. */
  private readTags(): ParsedTags {
    const parsed = parseTags(this.elements.tagsInput.value);
    const invalid = parsed.invalid.length > 0;
    this.elements.tagsInput.setAttribute("aria-invalid", String(invalid));
    this.elements.tagsError.hidden = !invalid;
    this.elements.tagsError.textContent = invalid
      ? `Tags must start with # and contain no spaces: ${parsed.invalid.join(" ")}`
      : "";
    return parsed;
  }

  private handleTagsChange(): void {
    this.parsedTags = this.readTags();
    savePreferences({ sessionTags: this.elements.tagsInput.value });
  }

  /** A button that appends `tag` to the tags input unless it's already there. */
  private suggestionButton(tag: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-suggestion";
    button.textContent = tag;
    button.addEventListener("click", () => {
      if (!this.parsedTags.tags.includes(tag)) {
        this.elements.tagsInput.value = `${this.elements.tagsInput.value.trim()} ${tag}`.trim();
        this.handleTagsChange();
      }
    });
    return button;
  }

  /** Fits the format and foil toggles to the selected game: keeps the
   * selected format if the game has it (otherwise its first), and turns foil
   * off for a game without foils. */
  private applyGameCardOptions(): void {
    const { cardFormats, hasFoil } = this.selectedGame;
    if (!cardFormats.includes(this.selectedCardFormat)) {
      this.selectedCardFormat = cardFormats[0]!;
    }
    this.elements.formatRadios[this.selectedCardFormat].checked = true;
    this.elements.formatToggle.hidden = cardFormats.length < 2;

    this.elements.foilToggle.hidden = !hasFoil;
    if (!hasFoil) {
      this.selectedFoil = false;
      this.elements.foilCheckbox.checked = false;
    }
  }

  private handleGameChange(): void {
    const game = this.games.find((g) => g.id === this.elements.gameSelect.value);
    if (!game) {
      throw new Error(`Unknown game option: ${this.elements.gameSelect.value}`);
    }
    this.selectedGame = game;
    this.selectedSet = this.populateSets(undefined);
    this.applyGameCardOptions();
    savePreferences({ gameId: game.id, setCode: this.selectedSet.code });
  }

  private handleSetChange(): void {
    const set = this.selectedGame.sets.find((s) => s.code === this.elements.setSelect.value);
    if (!set) {
      throw new Error(`Unknown set option: ${this.elements.setSelect.value}`);
    }
    this.selectedSet = set;
    savePreferences({ setCode: set.code });
  }

  private handleCameraChange(): void {
    const camera = this.cameras.find((c) => c.deviceId === this.elements.cameraSelect.value);
    if (!camera) {
      throw new Error(`Unknown camera option: ${this.elements.cameraSelect.value}`);
    }
    this.selectedCamera = camera;
    this.populateResolutions(camera);
    savePreferences({ cameraDeviceId: camera.deviceId, resolution: this.selectedResolution });
    this.onCameraSettingsChanged();
  }

  private handleResolutionChange(): void {
    const camera = this.selectedCamera;
    if (!camera) {
      throw new Error("Resolution changed with no camera selected.");
    }
    const selected = resolutionOptionsForCamera(camera.maxWidth, camera.maxHeight).find(
      (option) => resolutionOptionValue(option.size) === this.elements.resolutionSelect.value,
    );
    if (!selected) {
      throw new Error(`Unknown resolution option: ${this.elements.resolutionSelect.value}`);
    }
    this.selectedResolution = selected.size;
    savePreferences({ cameraDeviceId: camera.deviceId, resolution: this.selectedResolution });
    this.onCameraSettingsChanged();
  }
}

/** The resolution `<option value>` for a size. */
function resolutionOptionValue(size: Size): string {
  return `${size.width}x${size.height}`;
}

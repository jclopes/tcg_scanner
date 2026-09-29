import type { CardOrientation, Size } from "../core";
import { listFullHdCameras } from "./cameraDevices";
import type { CameraOption } from "./cameraDevices";
import { DEFAULT_CAMERA_RESOLUTION, resolutionOptionsForCamera } from "./config";
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
  orientationToggle: HTMLElement;
  orientationRadios: Record<CardOrientation, HTMLInputElement>;
  /** The Foil toggle (its label) and its checkbox. */
  foilToggle: HTMLElement;
  foilCheckbox: HTMLInputElement;
}

/**
 * The scan settings — game, set, camera, resolution, card orientation, foil
 * — and the current value of each. Game, set, camera and resolution are saved
 * as preferences and restored when still available; card orientation and
 * foil are sticky for the session only. The orientation toggle is shown only
 * for a game with both orientations, and the foil toggle only for a game with
 * foils (see GameOption). Session tags are separate (see SessionTagsInput).
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
  private selectedCardOrientation: CardOrientation;
  private selectedFoil = false;

  /** `onCameraSettingsChanged` runs after the camera or resolution changes. */
  constructor(
    private readonly elements: SettingsElements,
    private readonly onCameraSettingsChanged: () => void,
  ) {
    elements.gameSelect.replaceChildren(...this.games.map((game) => optionElement(game.id, game.id)));
    this.selectedGame = this.games.find((game) => game.id === this.preferences.gameId) ?? this.games[0]!;
    elements.gameSelect.value = this.selectedGame.id;
    this.selectedSet = this.populateSets(this.preferences.setCode);
    this.selectedCardOrientation = this.selectedGame.cardOrientations[0]!;
    this.applyGameCardOptions();

    elements.gameSelect.addEventListener("change", () => this.handleGameChange());
    elements.setSelect.addEventListener("change", () => this.handleSetChange());
    elements.cameraSelect.addEventListener("change", () => this.handleCameraChange());
    elements.resolutionSelect.addEventListener("change", () => this.handleResolutionChange());
    for (const [orientation, radio] of Object.entries(elements.orientationRadios) as [CardOrientation, HTMLInputElement][]) {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.selectedCardOrientation = orientation;
        }
      });
    }
    elements.foilCheckbox.addEventListener("change", () => {
      this.selectedFoil = elements.foilCheckbox.checked;
    });
  }

  get camera(): CameraOption | null {
    return this.selectedCamera;
  }

  get resolution(): Size {
    return this.selectedResolution;
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

  get cardOrientation(): CardOrientation {
    return this.selectedCardOrientation;
  }

  /** Whether the next accepted card is foil. Always false for a game
   * without foils. */
  get foil(): boolean {
    return this.selectedFoil;
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

  /** Fits the orientation and foil toggles to the selected game: keeps the
   * selected orientation if the game has it (otherwise its first), and turns foil
   * off for a game without foils. */
  private applyGameCardOptions(): void {
    const { cardOrientations, hasFoil } = this.selectedGame;
    if (!cardOrientations.includes(this.selectedCardOrientation)) {
      this.selectedCardOrientation = cardOrientations[0]!;
    }
    this.elements.orientationRadios[this.selectedCardOrientation].checked = true;
    this.elements.orientationToggle.hidden = cardOrientations.length < 2;

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

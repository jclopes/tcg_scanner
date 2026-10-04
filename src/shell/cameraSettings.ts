import type { Size } from "../core";
import { listFullHdCameras } from "./cameraDevices";
import type { CameraOption } from "./cameraDevices";
import { DEFAULT_CAMERA_RESOLUTION, resolutionOptionsForCamera } from "./config";
import { optionElement, placeholderOption } from "./dom";
import { loadPreferences, savePreferences } from "./preferences";

export interface CameraSettingsElements {
  cameraSelect: HTMLSelectElement;
  resolutionSelect: HTMLSelectElement;
}

/** The Settings screen's camera and resolution dropdowns. Both are saved as
 * preferences and restored when still available. */
export class CameraSettings {
  private readonly preferences = loadPreferences();
  private cameras: CameraOption[] = [];
  private selectedCamera: CameraOption | null = null;
  /** The requested resolution; the camera may negotiate a different one. */
  private selectedResolution: Size = this.preferences.resolution ?? DEFAULT_CAMERA_RESOLUTION;

  constructor(private readonly elements: CameraSettingsElements) {
    elements.cameraSelect.addEventListener("change", () => this.handleCameraChange());
    elements.resolutionSelect.addEventListener("change", () => this.handleResolutionChange());
  }

  /** null until cameras are listed, or when none supports Full HD. */
  get camera(): CameraOption | null {
    return this.selectedCamera;
  }

  get resolution(): Size {
    return this.selectedResolution;
  }

  /** Probes cameras for Full HD support and fills the camera dropdown,
   * restoring the saved choice when it's still present. */
  async populateCameras(): Promise<void> {
    this.cameras = await listFullHdCameras();
    const { cameraSelect, resolutionSelect } = this.elements;
    const none = this.cameras.length === 0;
    cameraSelect.disabled = none;
    resolutionSelect.disabled = none;
    if (none) {
      cameraSelect.replaceChildren(placeholderOption("No Full HD camera found"));
      resolutionSelect.replaceChildren();
      return;
    }
    cameraSelect.replaceChildren(...this.cameras.map((camera) => optionElement(camera.deviceId, camera.label)));
    this.selectedCamera = this.cameras.find((c) => c.deviceId === this.preferences.cameraDeviceId) ?? this.cameras[0]!;
    cameraSelect.value = this.selectedCamera.deviceId;
    this.populateResolutions(this.selectedCamera);
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

  private handleCameraChange(): void {
    const camera = this.cameras.find((c) => c.deviceId === this.elements.cameraSelect.value);
    if (!camera) {
      throw new Error(`Unknown camera option: ${this.elements.cameraSelect.value}`);
    }
    this.selectedCamera = camera;
    this.populateResolutions(camera);
    savePreferences({ cameraDeviceId: camera.deviceId, resolution: this.selectedResolution });
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
  }
}

/** The resolution `<option value>` for a size. */
function resolutionOptionValue(size: Size): string {
  return `${size.width}x${size.height}`;
}

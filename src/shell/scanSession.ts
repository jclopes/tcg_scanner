import { isConfidentMatch } from "../core";
import type { CardOrientation, PerEdge, Size } from "../core";
import type { CameraOption } from "./cameraDevices";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { captureFlattenedCard } from "./capture";
import { buildCaptureDebugTrail, buildForcedDebugTrail } from "./debugSteps";
import type { DebugEntry } from "./debugSteps";
import { DetectionLoop } from "./detectionLoop";
import { collectBurstFrames, selectFrameToFlatten } from "./frameBurst";
import { evaluateFrameForQuad } from "./frameDetection";
import type { AcceptedEvaluation } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import type { GameOption, GameSet } from "./gameConfig";
import { captureHiResStill } from "./hiResStill";
import { identifyCard } from "./identify";
import type { Identification } from "./identify";
import type { LazyOcrWorker } from "./ocr";

/** The scan's state. The camera is on in "scanning", "processing" and
 * "captured" (see isCameraOn) and released in "error". `message` replaces the
 * default status text. */
export type ScanState =
  | { phase: "stopped" }
  | { phase: "starting" }
  | { phase: "scanning" | "processing" | "captured"; message?: string }
  | { phase: "error"; message: string };

export function isCameraOn(state: ScanState): boolean {
  return state.phase === "scanning" || state.phase === "processing" || state.phase === "captured";
}

/** What a scan reads from the settings, at the moment it needs each value. */
export interface ScanInputs {
  camera: CameraOption | null;
  resolution: Size;
  game: GameOption;
  set: GameSet;
  cardOrientation: CardOrientation;
  debug: boolean;
}

/** An identified card awaiting the user's pick; `cycle` is the scan cycle it
 * belongs to (see ScanSession.fail). */
export interface Capture {
  set: GameSet;
  cardCanvas: HTMLCanvasElement;
  identification: Identification;
  cycle: number;
}

export interface ScanSessionEvents {
  onStateChange: (state: ScanState) => void;
  onEdgesEvaluated: (edgesFound: PerEdge<boolean>) => void;
  /** Card candidates were found; the state becomes "captured" right after. */
  onCapture: (capture: Capture) => void;
  onDebugTrail: (entries: DebugEntry[]) => void;
}

/** The scan lifecycle: camera → detect → burst → flatten → identify, then the
 * next card or a stop. Touches no DOM besides `video`. */
export class ScanSession {
  private current: ScanState = { phase: "stopped" };
  private detectionLoop: DetectionLoop | null = null;
  /** Incremented whenever a scan cycle ends, so async work from an older
   * cycle can tell it is stale (see isCurrentScan). */
  private scanCycle = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly ocrWorker: LazyOcrWorker,
    private readonly inputs: () => ScanInputs,
    private readonly events: ScanSessionEvents,
  ) {}

  get state(): ScanState {
    return this.current;
  }

  /** Starts the camera, then scanning. Throws unless stopped or showing an
   * error. */
  start(): void {
    if (this.current.phase !== "stopped" && this.current.phase !== "error") {
      throw new Error(`Scan started while ${this.current.phase}.`);
    }
    const { camera, resolution } = this.inputs();
    if (camera === null) {
      throw new Error("Scan started with no camera selected.");
    }
    this.setState({ phase: "starting" });
    this.startCamera(camera.deviceId, resolution).catch((error: unknown) => {
      console.error("Could not start the scan.", error);
      this.releaseCamera();
      this.setState({ phase: "error", message: describeError(error, "Could not start the scan.") });
    });
  }

  /** Releases the camera and stops scanning. Idempotent. */
  stop(): void {
    this.releaseCamera();
    this.setState({ phase: "stopped" });
  }

  /** Scans for the next card with the camera still on. Throws unless a card
   * was captured. */
  scanNext(message: string): void {
    if (this.current.phase !== "captured") {
      throw new Error(`Tried to scan the next card while ${this.current.phase}.`);
    }
    this.beginScan(++this.scanCycle, message);
  }

  /** Replaces the status text of the captured card. Throws unless a card was
   * captured. */
  setCapturedMessage(message: string): void {
    if (this.current.phase !== "captured") {
      throw new Error(`Tried to set a capture message while ${this.current.phase}.`);
    }
    this.setState({ phase: "captured", message });
  }

  /** Shows an error that isn't part of a scan (e.g. listing cameras failed).
   * Throws unless stopped. */
  showError(error: unknown, fallbackMessage: string): void {
    if (this.current.phase !== "stopped") {
      throw new Error(`Tried to show an error while ${this.current.phase}.`);
    }
    console.error(fallbackMessage, error);
    this.setState({ phase: "error", message: describeError(error, fallbackMessage) });
  }

  /** Ends scan cycle `cycle` on an unexpected failure, unless it's already
   * stale. */
  fail(error: unknown, fallbackMessage: string, cycle: number): void {
    if (!this.isCurrentScan(cycle)) {
      return;
    }
    console.error(fallbackMessage, error);
    this.releaseCamera();
    this.setState({ phase: "error", message: describeError(error, fallbackMessage) });
  }

  /** Shows what each edge detected on one frame, without affecting the scan:
   * a hi-res still when the camera supports one, otherwise the next live
   * frame. Throws unless scanning. */
  forceDebugCapture(): void {
    const loop = this.detectionLoop;
    if (this.current.phase !== "scanning" || loop === null) {
      throw new Error(`Debug capture requested while ${this.current.phase}.`);
    }
    const cycle = this.scanCycle;
    this.captureDebugFrame(loop, cycle).catch((error: unknown) => this.fail(error, "Debug capture failed.", cycle));
  }

  private async startCamera(deviceId: string, resolution: Size): Promise<void> {
    try {
      await startCameraStream(this.video, resolution, deviceId);
    } catch (error: unknown) {
      stopCameraStream(this.video);
      if (this.current.phase === "starting") {
        this.setState({ phase: "error", message: describeError(error, "Could not start the camera.") });
      }
      return;
    }
    if (this.current.phase !== "starting") {
      // Stopped while starting, e.g. the page was hidden.
      stopCameraStream(this.video);
      return;
    }
    this.beginScan(++this.scanCycle);
  }

  private beginScan(cycle: number, message?: string): void {
    const { debug } = this.inputs();
    this.setState({ phase: "scanning", message });

    const loop = new DetectionLoop(this.video);
    this.detectionLoop = loop;
    loop.start({
      onAccepted: (evaluation) => {
        if (this.isCurrentScan(cycle)) {
          this.confirmAndCapture(evaluation, cycle, debug).catch((error: unknown) => this.fail(error, "Capture failed.", cycle));
        }
      },
      onFrameEvaluated: (edgesFound) => {
        if (this.isCurrentScan(cycle)) {
          this.events.onEdgesEvaluated(edgesFound);
        }
      },
      onError: (error) => this.fail(error, "Card detection failed.", cycle),
    });
  }

  /** After the preview frame is accepted: burst, flatten the best frame and
   * identify the card; without a confident match, scan again. */
  private async confirmAndCapture(preview: AcceptedEvaluation, cycle: number, debug: boolean): Promise<void> {
    const isCancelled = (): boolean => !this.isCurrentScan(cycle);
    this.setState({ phase: "processing" });

    const burst = await collectBurstFrames(this.video, debug, isCancelled);
    if (isCancelled()) {
      return;
    }
    const { cardOrientation, game, set } = this.inputs();
    const selected = selectFrameToFlatten(burst.accepted, preview.frame);
    const cardCanvas = captureFlattenedCard(selected, cardOrientation);

    this.setState({ phase: "processing", message: "Identifying…" });
    const worker = await this.ocrWorker.get();
    const identification = await identifyCard(worker, selected, cardOrientation, game, set, isCancelled);
    if (identification === null || isCancelled()) {
      return;
    }

    if (debug) {
      this.events.onDebugTrail(buildCaptureDebugTrail(preview, burst, selected, cardCanvas, identification.regions));
    }
    if (!isConfidentMatch(identification.matches)) {
      this.beginScan(++this.scanCycle, "Couldn't read the card number — scanning again.");
      return;
    }
    this.events.onCapture({ set, cardCanvas, identification, cycle });
    this.setState({ phase: "captured" });
  }

  private async captureDebugFrame(loop: DetectionLoop, cycle: number): Promise<void> {
    const still = await captureHiResStill(this.video);
    if (still === null) {
      loop.requestForcedDebugCapture((evaluation) =>
        this.events.onDebugTrail(buildForcedDebugTrail(evaluation, "Live preview frame")),
      );
      return;
    }
    const frameSize: Size = { width: still.width, height: still.height };
    const evaluation = evaluateFrameForQuad(new FrameSampler(), still, frameSize);
    if (this.isCurrentScan(cycle)) {
      this.events.onDebugTrail(buildForcedDebugTrail(evaluation, `Hi-res still — ${frameSize.width} × ${frameSize.height}`));
    }
  }

  private isCurrentScan(cycle: number): boolean {
    return cycle === this.scanCycle && isCameraOn(this.current);
  }

  private releaseCamera(): void {
    this.scanCycle += 1;
    this.detectionLoop?.stop();
    this.detectionLoop = null;
    stopCameraStream(this.video);
  }

  private setState(next: ScanState): void {
    this.current = next;
    this.events.onStateChange(next);
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

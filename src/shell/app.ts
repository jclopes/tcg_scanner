import { isConfidentMatch } from "../core";
import type { OpenCv, Size } from "../core";
import { createEdgeDetectionPool } from "../workers";
import type { EdgeDetectionPool } from "../workers";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { captureFlattenedCard } from "./capture";
import { buildCaptureDebugTrail, buildForcedDebugTrail, DebugPanel } from "./debugSteps";
import { DetectionLoop } from "./detectionLoop";
import type { DetectionLoopResult } from "./detectionLoop";
import { requireElement } from "./dom";
import { collectBurstFrames, selectFrameToFlatten } from "./frameBurst";
import { evaluateFrameForQuad } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import type { GameSet } from "./gameConfig";
import { GuideFeedback } from "./guideFeedback";
import { captureHiResStill } from "./hiResStill";
import { IdentificationView } from "./identificationView";
import { identifyCard } from "./identify";
import { ManualCardEntry } from "./manualEntry";
import { LazyOcrWorker } from "./ocr";
import { watchVideoFrameSize } from "./orientationWatcher";
import { ResultImage } from "./resultView";
import { ScannedCardList } from "./scannedCards";
import { SettingsPanel } from "./settings";
import { INITIAL_SCAN_STATE } from "./state";
import type { ScanState } from "./state";

type CameraStatus = "stopped" | "starting" | "active";

/**
 * Wires the shell modules to the page and runs the scan lifecycle:
 * start camera → detect → burst → flatten → identify → stop. Called once from
 * src/main.ts after OpenCV.js loads.
 */
export function initApp(cv: OpenCv): void {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resultSection = requireElement<HTMLElement>("result");
  const resolutionStatus = requireElement<HTMLElement>("resolution-status");
  const debugCheckbox = requireElement<HTMLInputElement>("debug-checkbox");
  const debugPanelElement = requireElement<HTMLElement>("debug-panel");
  const debugControls = requireElement<HTMLElement>("debug-controls");
  const debugForceButton = requireElement<HTMLButtonElement>("debug-force-button");

  const settings = new SettingsPanel(
    {
      gameSelect: requireElement("game-select"),
      setSelect: requireElement("set-select"),
      cameraSelect: requireElement("camera-select"),
      resolutionSelect: requireElement("resolution-select"),
      formatToggle: requireElement("format-toggle"),
      formatRadios: { portrait: requireElement("format-portrait"), landscape: requireElement("format-landscape") },
      foilToggle: requireElement("foil-toggle"),
      foilCheckbox: requireElement("foil-checkbox"),
      tagsInput: requireElement("tags-input"),
      tagSuggestions: requireElement("tag-suggestions"),
      tagsError: requireElement("tags-error"),
    },
    restartScanIfActive,
  );
  const guide = new GuideFeedback(requireElement("guide-overlay"), video, () => settings.cardFormat);
  const resultImage = new ResultImage(requireElement("result-image"));
  const scannedCards = new ScannedCardList(
    requireElement("scanned-cards-list"),
    requireElement("scanned-cards-empty"),
    requireElement("scanned-cards-download"),
    requireElement("scanned-cards-clear"),
  );
  const identificationView = new IdentificationView(
    requireElement("identification"),
    requireElement("identification-status"),
    requireElement("identification-warning"),
    requireElement("identification-results"),
    acceptCard,
  );
  new ManualCardEntry(
    {
      form: requireElement("manual-entry"),
      input: requireElement("manual-entry-input"),
      suggestions: requireElement("manual-entry-options"),
      error: requireElement("manual-entry-error"),
    },
    () => settings.set,
    (set, cardId) => {
      if (!addScannedCard(set, cardId)) {
        return "Fix the session tags before adding the card.";
      }
      return null;
    },
  );
  const debugPanel = new DebugPanel(debugPanelElement);
  const ocrWorker = new LazyOcrWorker();

  let state: ScanState = INITIAL_SCAN_STATE;
  let cameraStatus: CameraStatus = "stopped";
  let pool: EdgeDetectionPool | null = null;
  let detectionLoop: DetectionLoop | null = null;
  /** Incremented whenever a scan cycle ends, so async work from an older
   * cycle can tell it is stale (see isCurrentScan). */
  let scanRequest = 0;
  /** Read when a scan starts; toggling mid-scan applies to the next scan. */
  let debugEnabled = false;

  function isCurrentScan(requestId: number): boolean {
    return requestId === scanRequest && cameraStatus === "active";
  }

  // ---- Rendering ----------------------------------------------------------

  function render(): void {
    statusEl.textContent = cameraStatus === "starting" ? "Starting camera…" : statusMessage(state);
    statusEl.dataset.kind = state.phase === "error" ? "error" : "";

    scanButton.disabled = cameraStatus === "starting" || !settings.camera;
    scanButton.textContent = scanButtonLabel(cameraStatus);
    settings.setCameraStarting(cameraStatus === "starting");
    debugForceButton.disabled = cameraStatus !== "active";
    resultSection.hidden = state.phase !== "captured";
  }

  function setState(next: ScanState): void {
    state = next;
    render();
  }

  /** Shows an unexpected failure of scan cycle `requestId`, unless that cycle
   * is already stale. */
  function failScan(error: unknown, fallbackMessage: string, requestId: number): void {
    if (!isCurrentScan(requestId)) {
      return;
    }
    console.error(fallbackMessage, error);
    guide.clear();
    setState({ phase: "error", message: describeError(error, fallbackMessage) });
  }

  // ---- Scan lifecycle -----------------------------------------------------

  /** getUserMedia constraints only apply at acquisition, so a camera or
   * resolution change restarts the running scan. */
  function restartScanIfActive(): void {
    if (cameraStatus === "active") {
      stopScan();
      void startScan();
    }
  }

  /** Records the card the user picked from the best matches (see
   * addScannedCard) and starts detecting the next card. */
  function acceptCard(set: GameSet, cardId: string): void {
    if (cameraStatus !== "active" || !pool) {
      throw new Error("A card was accepted with no scan running.");
    }
    if (!addScannedCard(set, cardId)) {
      setState({ phase: "captured", message: "Fix the session tags before adding the card." });
      return;
    }
    resultImage.clear();
    identificationView.clear();
    debugPanel.clear();
    beginScan(pool, ++scanRequest, `Added ${cardId} — scanning for the next card.`);
  }

  /** Adds the card to the scanned list with the foil toggle's state and the
   * session tags. Returns false,
   * adding nothing, while the tags input holds invalid tags — a card is never
   * saved with tags the user didn't mean. */
  function addScannedCard(set: GameSet, cardId: string): boolean {
    const { tags, invalid } = settings.sessionTags;
    if (invalid.length > 0) {
      return false;
    }
    scannedCards.add(set.code, cardId, settings.foil, tags);
    return true;
  }

  async function startScan(): Promise<void> {
    const camera = settings.camera;
    if (cameraStatus !== "stopped" || !camera) {
      throw new Error(`Scan started with the camera ${cameraStatus} and ${camera ? "a" : "no"} camera selected.`);
    }

    resultImage.clear();
    identificationView.clear();
    debugPanel.clear();
    cameraStatus = "starting";
    setState({ phase: "idle" });
    try {
      await startCameraStream(video, settings.resolution, camera.deviceId);
    } catch (error: unknown) {
      cameraStatus = "stopped";
      stopCameraStream(video);
      setState({ phase: "error", message: describeError(error, "Could not start the camera.") });
      return;
    }
    cameraStatus = "active";
    pool ??= createEdgeDetectionPool();
    beginScan(pool, ++scanRequest);
  }

  /** Runs the detection loop; `message` replaces the default scanning status
   * (e.g. to say why scanning restarted). */
  function beginScan(activePool: EdgeDetectionPool, requestId: number, message?: string): void {
    const debug = debugEnabled;
    setState({ phase: "scanning", message });
    guide.start();

    detectionLoop = new DetectionLoop(video, activePool);
    detectionLoop.start({
      onAccepted: (result) => {
        if (!isCurrentScan(requestId)) {
          return;
        }
        // The guide stays visible through "processing"; a running flash still
        // ends and returns to the per-edge colors.
        void confirmAndCapture(activePool, result, requestId, debug);
      },
      onFrameEvaluated: (edgesFound) => {
        if (isCurrentScan(requestId)) {
          guide.update(edgesFound);
        }
      },
      onError: (error) => failScan(error, "Card detection failed.", requestId),
    });
  }

  /**
   * After the preview frame is accepted: collect a burst of accepted frames,
   * flatten only the best one (or the preview frame if the burst found none),
   * show it and identify the card. Without a confident collector-number
   * match (see isConfidentMatch), detection restarts instead.
   */
  async function confirmAndCapture(
    activePool: EdgeDetectionPool,
    preview: DetectionLoopResult,
    requestId: number,
    debug: boolean,
  ): Promise<void> {
    const isCancelled = (): boolean => !isCurrentScan(requestId);
    try {
      setState({ phase: "processing" });

      const burst = await collectBurstFrames(video, activePool, debug, isCancelled);
      if (isCancelled()) {
        return;
      }

      const { cardFormat, game, set } = settings;
      const selected = selectFrameToFlatten(burst.accepted, preview.frame);
      const cardCanvas = captureFlattenedCard(cv, selected, cardFormat);
      resultImage.show(cardCanvas).catch((error: unknown) => failScan(error, "Could not encode the captured image.", requestId));

      identificationView.showPending();
      const worker = await ocrWorker.get();
      const identification = await identifyCard(cv, worker, selected, cardFormat, game.config, set, isCancelled);
      if (isCancelled()) {
        return;
      }

      if (debug) {
        debugPanel.render(buildCaptureDebugTrail(preview, burst, selected, cardCanvas, identification.regions));
      }
      if (!isConfidentMatch(identification.matches)) {
        resultImage.clear();
        identificationView.clear();
        beginScan(activePool, ++scanRequest, "Couldn't read the card number — scanning again.");
        return;
      }

      identificationView.show(game.config.game, set, identification);
      guide.clear();
      setState({ phase: "captured" });
    } catch (error: unknown) {
      failScan(error, "Capture failed.", requestId);
    }
  }

  function stopScan(): void {
    releaseScanResources();
    guide.clear();
    resultImage.clear();
    identificationView.clear();
    resolutionStatus.textContent = "-";
    setState({ phase: "idle" });
  }

  function releaseScanResources(): void {
    scanRequest += 1;
    guide.freeze();
    detectionLoop?.stop();
    detectionLoop = null;
    pool?.terminate();
    pool = null;
    stopCameraStream(video);
    cameraStatus = "stopped";
  }

  // ---- Debug --------------------------------------------------------------

  /**
   * Shows what each edge detected on one frame, without affecting the scan:
   * a hi-res still when the camera supports one, otherwise the next live
   * frame the loop evaluates.
   */
  async function handleDebugForceCapture(requestId: number): Promise<void> {
    if (!pool || !detectionLoop) {
      throw new Error("Debug capture requires a running scan.");
    }

    const still = await captureHiResStill(video);
    if (!still) {
      detectionLoop.requestForcedDebugCapture((evaluation) =>
        debugPanel.render(buildForcedDebugTrail(evaluation, "Live preview frame")),
      );
      return;
    }

    const frameSize: Size = { width: still.width, height: still.height };
    const evaluation = await evaluateFrameForQuad(new FrameSampler(), pool, still, frameSize);
    if (isCurrentScan(requestId)) {
      debugPanel.render(buildForcedDebugTrail(evaluation, `Hi-res still — ${frameSize.width} × ${frameSize.height}`));
    }
  }

  // ---- Event wiring -------------------------------------------------------

  debugCheckbox.addEventListener("change", () => {
    debugEnabled = debugCheckbox.checked;
    debugPanelElement.hidden = !debugEnabled;
    debugControls.hidden = !debugEnabled;
    if (!debugEnabled) {
      debugPanel.clear();
    }
  });

  debugForceButton.addEventListener("click", () => {
    const requestId = scanRequest;
    handleDebugForceCapture(requestId).catch((error: unknown) => failScan(error, "Debug capture failed.", requestId));
  });

  scanButton.addEventListener("click", () => {
    if (cameraStatus === "active") {
      stopScan();
    } else {
      void startScan();
    }
  });

  watchVideoFrameSize(video, (frameSize) => {
    // The actual negotiated resolution, which may differ from the requested one.
    resolutionStatus.textContent = `${frameSize.width} × ${frameSize.height}`;
    // Keeps the stage (and so the overlay canvas's CSS box) matching the
    // video's frame shape; index.html sizes the stage from it.
    cameraStage.style.setProperty("--frame-aspect", String(frameSize.width / frameSize.height));
    if (state.phase === "scanning") {
      guide.redraw();
    }
  });

  window.addEventListener("pagehide", () => {
    // Also fires when entering the back-forward cache, where this JS state
    // survives; releasing (not just terminating) resources ensures a restore
    // doesn't keep a dead pool or OCR worker around.
    releaseScanResources();
    guide.clear();
    render();
    ocrWorker.terminate();
  });

  setState(INITIAL_SCAN_STATE);
  settings.populateCameras().then(render, (error: unknown) => {
    console.error("Could not list cameras.", error);
    setState({ phase: "error", message: describeError(error, "Could not list cameras.") });
  });
}

function statusMessage(state: ScanState): string {
  switch (state.phase) {
    case "idle":
      return "Ready. Press Start Scan to detect a card.";
    case "scanning":
      return state.message ?? "Scanning — align the card with the guide.";
    case "processing":
      return "Card detected — hold it still…";
    case "captured":
      return state.message ?? "Card captured.";
    case "error":
      return state.message ?? "Something went wrong.";
  }
}

function scanButtonLabel(cameraStatus: CameraStatus): string {
  switch (cameraStatus) {
    case "starting":
      return "Starting camera…";
    case "active":
      return "Stop Scan";
    case "stopped":
      return "Start Scan";
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

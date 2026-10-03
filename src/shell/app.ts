import { isConfidentMatch } from "../core";
import type { Size } from "../core";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { captureFlattenedCard } from "./capture";
import { buildCaptureDebugTrail, buildForcedDebugTrail, DebugPanel } from "./debugSteps";
import { DetectionLoop } from "./detectionLoop";
import { requireElement } from "./dom";
import { collectBurstFrames, selectFrameToFlatten } from "./frameBurst";
import { evaluateFrameForQuad } from "./frameDetection";
import type { AcceptedEvaluation } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import type { GameSet } from "./gameConfig";
import { GuideFeedback } from "./guideFeedback";
import { captureHiResStill } from "./hiResStill";
import { IdentificationView } from "./identificationView";
import { identifyCard } from "./identify";
import { ManualCardEntry } from "./manualEntry";
import { LazyOcrWorker } from "./ocr";
import { watchVideoFrameSize } from "./orientationWatcher";
import { ResultView } from "./resultView";
import { ScannedCardList } from "./scannedCards";
import { ScanSounds } from "./scanSounds";
import { ScreenNavigator } from "./screens";
import type { ScreenName } from "./screens";
import { SessionTagsInput } from "./sessionTags";
import { SettingsPanel } from "./settings";
import { INITIAL_SCAN_STATE } from "./state";
import type { ScanState } from "./state";

type CameraStatus = "stopped" | "starting" | "active";

/**
 * Wires the shell modules to the page and runs the scan lifecycle:
 * start camera → detect → burst → flatten → identify → stop. Called once from
 * src/main.ts.
 */
export function initApp(): void {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resolutionStatus = requireElement<HTMLElement>("resolution-status");
  const debugForceButton = requireElement<HTMLButtonElement>("debug-force-button");
  const captureFlash = requireElement<HTMLDivElement>("capture-flash");

  const settings = new SettingsPanel(
    {
      gameSelect: requireElement("game-select"),
      setSelect: requireElement("set-select"),
      cameraSelect: requireElement("camera-select"),
      resolutionSelect: requireElement("resolution-select"),
      orientationToggle: requireElement("orientation-toggle"),
      orientationRadios: { portrait: requireElement("orientation-portrait"), landscape: requireElement("orientation-landscape") },
      foilToggle: requireElement("foil-toggle"),
      foilCheckbox: requireElement("foil-checkbox"),
    },
    restartScanIfActive,
  );
  const sessionTags = new SessionTagsInput({
    input: requireElement("tags-input"),
    error: requireElement("tags-error"),
  });
  const guide = new GuideFeedback(requireElement("guide-overlay"), video, () => settings.cardOrientation);
  const resultView = new ResultView({
    thumbnailButton: requireElement("result"),
    thumbnail: requireElement("result-image"),
    overlay: requireElement("card-overlay"),
    overlayImage: requireElement("card-overlay-image"),
  });
  const scannedCards = new ScannedCardList(settings.allGames, {
    list: requireElement("scanned-cards-list"),
    count: requireElement("scanned-cards-count"),
    emptyNote: requireElement("scanned-cards-empty"),
    downloadButton: requireElement("scanned-cards-download"),
    mergeButton: requireElement("scanned-cards-merge"),
    clearButton: requireElement("scanned-cards-clear"),
  });
  const identificationView = new IdentificationView(
    requireElement("identification-warning"),
    requireElement("identification-matches"),
    acceptCard,
    rescan,
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
  const debugPanel = new DebugPanel({
    panel: requireElement("debug-panel"),
    checkbox: requireElement("debug-checkbox"),
    controls: requireElement("debug-controls"),
  });
  const ocrWorker = new LazyOcrWorker();
  const sounds = new ScanSounds(requireElement("sound-checkbox"));
  const screens = new ScreenNavigator(
    {
      screens: { scan: requireElement("screen-scan"), game: requireElement("screen-game"), settings: requireElement("screen-settings") },
      tabs: { scan: requireElement("tab-scan"), game: requireElement("tab-game"), settings: requireElement("tab-settings") },
    },
    settings.hasSavedGame ? "scan" : "game",
    handleNavigate,
  );

  let state: ScanState = INITIAL_SCAN_STATE;
  let cameraStatus: CameraStatus = "stopped";
  let detectionLoop: DetectionLoop | null = null;
  /** Incremented whenever a scan cycle ends, so async work from an older
   * cycle can tell it is stale (see isCurrentScan). */
  let scanRequest = 0;

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
    // No leaving the scan screen mid-start: the camera would come up hidden
    // (see handleNavigate).
    screens.setEnabled(cameraStatus !== "starting");
    // A forced capture needs a running detection loop (see handleDebugForceCapture).
    debugForceButton.disabled = state.phase !== "scanning";
    // The camera check matters on pagehide, which releases the camera
    // without leaving the "scanning" phase.
    sounds.setHeartbeat(state.phase === "scanning" && cameraStatus === "active");
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
    resultView.clear();
    identificationView.clear();
    setState({ phase: "error", message: describeError(error, fallbackMessage) });
  }

  // ---- Scan lifecycle -----------------------------------------------------

  /** getUserMedia constraints only apply at acquisition, so a camera or
   * resolution change restarts the running scan. */
  function restartScanIfActive(): void {
    if (cameraStatus === "active") {
      stopScan();
      runStartScan();
    }
  }

  /** Starts a scan, showing any failure in the status line. */
  function runStartScan(): void {
    startScan().catch((error: unknown) => {
      console.error("Could not start the scan.", error);
      setState({ phase: "error", message: describeError(error, "Could not start the scan.") });
    });
  }

  /** Records the card the user picked from the best matches (see
   * addScannedCard) and starts detecting the next card. */
  function acceptCard(set: GameSet, cardId: string): void {
    if (cameraStatus !== "active") {
      throw new Error("A card was accepted with no scan running.");
    }
    if (!addScannedCard(set, cardId)) {
      setState({ phase: "captured", message: "Fix the session tags before adding the card." });
      return;
    }
    scanNextCard(`Added ${cardId} — scanning for the next card.`);
  }

  /** Discards the capture without adding a card (none of the matches was
   * right) and scans again. */
  function rescan(): void {
    scanNextCard("Scanning again.");
  }

  /** Clears the captured result and restarts detection with the camera still
   * running. */
  function scanNextCard(message: string): void {
    if (cameraStatus !== "active") {
      throw new Error("Tried to scan the next card with no scan running.");
    }
    resultView.clear();
    identificationView.clear();
    debugPanel.clear();
    beginScan(++scanRequest, message);
  }

  /** Adds the card to the scanned list with the game, the foil and
   * orientation toggles' state and the session tags. Returns false,
   * adding nothing, while the tags input holds invalid tags — a card is never
   * saved with tags the user didn't mean. */
  function addScannedCard(set: GameSet, cardId: string): boolean {
    const { tags, invalid } = sessionTags.parsed;
    if (invalid.length > 0) {
      return false;
    }
    scannedCards.add({
      gameId: settings.game.id,
      setCode: set.code,
      cardId,
      foil: settings.foil,
      orientation: settings.cardOrientation,
      tags,
    });
    return true;
  }

  async function startScan(): Promise<void> {
    const camera = settings.camera;
    if (cameraStatus !== "stopped" || !camera) {
      throw new Error(`Scan started with the camera ${cameraStatus} and ${camera ? "a" : "no"} camera selected.`);
    }

    resultView.clear();
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
    beginScan(++scanRequest);
  }

  /** Runs the detection loop; `message` replaces the default scanning status
   * (e.g. to say why scanning restarted). */
  function beginScan(requestId: number, message?: string): void {
    const debug = debugPanel.enabled;
    setState({ phase: "scanning", message });
    guide.start();

    detectionLoop = new DetectionLoop(video);
    detectionLoop.start({
      onAccepted: (result) => {
        if (!isCurrentScan(requestId)) {
          return;
        }
        // The guide stays visible through "processing"; a running flash still
        // ends and returns to the per-edge colors.
        void confirmAndCapture(result, requestId, debug);
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
    preview: AcceptedEvaluation,
    requestId: number,
    debug: boolean,
  ): Promise<void> {
    const isCancelled = (): boolean => !isCurrentScan(requestId);
    try {
      setState({ phase: "processing" });

      const burst = await collectBurstFrames(video, debug, isCancelled);
      if (isCancelled()) {
        return;
      }

      const { cardOrientation, game, set } = settings;
      const selected = selectFrameToFlatten(burst.accepted, preview.frame);
      const cardCanvas = captureFlattenedCard(selected, cardOrientation);

      setState({ phase: "processing", message: "Identifying…" });
      const worker = await ocrWorker.get();
      const identification = await identifyCard(worker, selected, cardOrientation, game, set, isCancelled);
      if (!identification || isCancelled()) {
        return;
      }

      if (debug) {
        debugPanel.render(buildCaptureDebugTrail(preview, burst, selected, cardCanvas, identification.regions));
      }
      if (!isConfidentMatch(identification.matches)) {
        resultView.clear();
        identificationView.clear();
        beginScan(++scanRequest, "Couldn't read the card number — scanning again.");
        return;
      }

      resultView
        .show(cardCanvas, identification.collectorNumberCrop)
        .catch((error: unknown) => failScan(error, "Could not encode the captured image.", requestId));
      identificationView.show(set, identification);
      captureFlash.animate([{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }], { duration: 300, iterations: 2 });
      sounds.ping();
      guide.clear();
      setState({ phase: "captured" });
    } catch (error: unknown) {
      failScan(error, "Capture failed.", requestId);
    }
  }

  function stopScan(): void {
    releaseScanResources();
    guide.clear();
    resultView.clear();
    identificationView.clear();
    resolutionStatus.textContent = "-";
    setState({ phase: "idle" });
  }

  function releaseScanResources(): void {
    scanRequest += 1;
    guide.freeze();
    detectionLoop?.stop();
    detectionLoop = null;
    stopCameraStream(video);
    cameraStatus = "stopped";
  }

  // ---- Screens ----------------------------------------------------------

  /** A running scan stops when its screen is left, so it never captures a
   * card while hidden. The game choice is saved on leaving its screen, so
   * the next launch opens on the scan screen. */
  function handleNavigate(from: ScreenName): void {
    if (cameraStatus === "starting") {
      throw new Error("Navigated away while the camera was starting.");
    }
    if (from === "scan" && cameraStatus === "active") {
      stopScan();
    }
    if (from === "game") {
      settings.saveGameChoice();
    }
  }

  // ---- Debug --------------------------------------------------------------

  /**
   * Shows what each edge detected on one frame, without affecting the scan:
   * a hi-res still when the camera supports one, otherwise the next live
   * frame the loop evaluates.
   */
  async function handleDebugForceCapture(requestId: number): Promise<void> {
    if (!detectionLoop) {
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
    const evaluation = evaluateFrameForQuad(new FrameSampler(), still, frameSize);
    if (isCurrentScan(requestId)) {
      debugPanel.render(buildForcedDebugTrail(evaluation, `Hi-res still — ${frameSize.width} × ${frameSize.height}`));
    }
  }

  // ---- Event wiring -------------------------------------------------------

  debugForceButton.addEventListener("click", () => {
    const requestId = scanRequest;
    handleDebugForceCapture(requestId).catch((error: unknown) => failScan(error, "Debug capture failed.", requestId));
  });

  scanButton.addEventListener("click", () => {
    if (cameraStatus === "active") {
      stopScan();
    } else {
      sounds.unlock();
      runStartScan();
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
    // doesn't keep a dead OCR worker around.
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
      return state.message ?? "Card detected — hold it still…";
    case "captured":
      return state.message ?? "Tap the matching card number:";
    case "error":
      return state.message;
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

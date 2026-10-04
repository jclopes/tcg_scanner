import { CameraSettings } from "./cameraSettings";
import { CardOptions } from "./cardOptions";
import { DebugPanel } from "./debugSteps";
import { requireElement } from "./dom";
import { GameChoice } from "./gameChoice";
import type { GameSet } from "./gameConfig";
import { GuideFeedback } from "./guideFeedback";
import { IdentificationView } from "./identificationView";
import { ManualCardEntry } from "./manualEntry";
import { LazyOcrWorker } from "./ocr";
import { watchVideoFrameSize } from "./orientationWatcher";
import { ResultView } from "./resultView";
import { ScannedCardList } from "./scannedCards";
import { isCameraOn, ScanSession } from "./scanSession";
import type { Capture, ScanState } from "./scanSession";
import { ScanSounds } from "./scanSounds";
import { ScreenNavigator } from "./screens";
import type { ScreenName } from "./screens";
import { SessionTagsInput } from "./sessionTags";

const TAGS_ERROR = "Fix the session tags before adding the card.";

/** Wires the page to the scan session and the other shell modules. Called
 * once from src/main.ts. */
export function initApp(): void {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resolutionStatus = requireElement<HTMLElement>("resolution-status");
  const debugForceButton = requireElement<HTMLButtonElement>("debug-force-button");
  const captureFlash = requireElement<HTMLDivElement>("capture-flash");

  const gameChoice = new GameChoice(
    { gameSelect: requireElement("game-select"), setSelect: requireElement("set-select") },
    (game) => cardOptions.applyGame(game),
  );
  const cardOptions = new CardOptions(
    {
      orientationToggle: requireElement("orientation-toggle"),
      orientationRadios: { portrait: requireElement("orientation-portrait"), landscape: requireElement("orientation-landscape") },
      foilToggle: requireElement("foil-toggle"),
      foilCheckbox: requireElement("foil-checkbox"),
    },
    gameChoice.game,
  );
  const cameraSettings = new CameraSettings({
    cameraSelect: requireElement("camera-select"),
    resolutionSelect: requireElement("resolution-select"),
  });
  const sessionTags = new SessionTagsInput({
    input: requireElement("tags-input"),
    error: requireElement("tags-error"),
  });
  const guide = new GuideFeedback(requireElement("guide-overlay"), video, () => cardOptions.cardOrientation);
  const resultView = new ResultView({
    thumbnailButton: requireElement("result"),
    thumbnail: requireElement("result-image"),
    overlay: requireElement("card-overlay"),
    overlayImage: requireElement("card-overlay-image"),
  });
  const scannedCards = new ScannedCardList(gameChoice.allGames, {
    list: requireElement("scanned-cards-list"),
    count: requireElement("scanned-cards-count"),
    emptyNote: requireElement("scanned-cards-empty"),
    storageError: requireElement("scanned-cards-error"),
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
    () => gameChoice.set,
    addScannedCard,
  );
  const debugPanel = new DebugPanel({
    panel: requireElement("debug-panel"),
    checkbox: requireElement("debug-checkbox"),
    controls: requireElement("debug-controls"),
  });
  const ocrWorker = new LazyOcrWorker();
  const sounds = new ScanSounds(requireElement("sound-checkbox"));
  const session = new ScanSession(
    video,
    ocrWorker,
    () => ({
      camera: cameraSettings.camera,
      resolution: cameraSettings.resolution,
      game: gameChoice.game,
      set: gameChoice.set,
      cardOrientation: cardOptions.cardOrientation,
      debug: debugPanel.enabled,
    }),
    {
      onStateChange: handleStateChange,
      onEdgesEvaluated: (edgesFound) => guide.update(edgesFound),
      onCapture: showCapture,
      onDebugTrail: (entries) => debugPanel.render(entries),
    },
  );
  const screens = new ScreenNavigator(
    {
      screens: { scan: requireElement("screen-scan"), game: requireElement("screen-game"), settings: requireElement("screen-settings") },
      tabs: { scan: requireElement("tab-scan"), game: requireElement("tab-game"), settings: requireElement("tab-settings") },
    },
    gameChoice.hasSavedGame ? "scan" : "game",
    handleNavigate,
  );

  // ---- Rendering ----------------------------------------------------------

  function handleStateChange(state: ScanState): void {
    // Every switch to "scanning" starts a new detection cycle.
    if (state.phase === "scanning") {
      guide.start();
    }
    render(state);
  }

  function render(state: ScanState): void {
    const starting = state.phase === "starting";
    statusEl.textContent = statusMessage(state);
    statusEl.dataset.kind = state.phase === "error" ? "error" : "";
    scanButton.disabled = starting || cameraSettings.camera === null;
    scanButton.textContent = scanButtonLabel(state);
    // No leaving the scan screen mid-start: the camera would come up hidden.
    screens.setEnabled(!starting);
    debugForceButton.disabled = state.phase !== "scanning";
    sounds.setHeartbeat(state.phase === "scanning");
    if (state.phase !== "scanning" && state.phase !== "processing") {
      guide.clear();
    }
    if (state.phase !== "captured") {
      resultView.clear();
      identificationView.clear();
    }
    if (!isCameraOn(state)) {
      resolutionStatus.textContent = "-";
    }
  }

  function showCapture({ set, cardCanvas, identification, cycle }: Capture): void {
    resultView
      .show(cardCanvas, identification.collectorNumberCrop)
      .catch((error: unknown) => session.fail(error, "Could not encode the captured image.", cycle));
    identificationView.show(set, identification);
    captureFlash.animate([{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }], { duration: 300, iterations: 2 });
    sounds.ping();
  }

  // ---- Cards --------------------------------------------------------------

  /** Records the card the user picked from the best matches and scans for
   * the next one. */
  function acceptCard(set: GameSet, cardId: string): void {
    const error = addScannedCard(set, cardId);
    if (error !== null) {
      session.setCapturedMessage(error);
      return;
    }
    debugPanel.clear();
    session.scanNext(`Added ${cardId} — scanning for the next card.`);
  }

  /** Discards the capture without adding a card (none of the matches was
   * right) and scans again. */
  function rescan(): void {
    debugPanel.clear();
    session.scanNext("Scanning again.");
  }

  /** Adds the card with the game, the foil and orientation toggles and the
   * session tags. Returns an error message, adding nothing, while the tags
   * input holds invalid tags. */
  function addScannedCard(set: GameSet, cardId: string): string | null {
    const { tags, invalid } = sessionTags.parsed;
    if (invalid.length > 0) {
      return TAGS_ERROR;
    }
    scannedCards.add({
      gameId: gameChoice.game.id,
      setCode: set.code,
      cardId,
      foil: cardOptions.foil,
      orientation: cardOptions.cardOrientation,
      tags,
    });
    return null;
  }

  // ---- Screens ------------------------------------------------------------

  /** A running scan stops when its screen is left, so it never captures a
   * card while hidden. The game choice is saved on leaving its screen, so
   * the next launch opens on the scan screen. */
  function handleNavigate(from: ScreenName): void {
    if (session.state.phase === "starting") {
      throw new Error("Navigated away while the camera was starting.");
    }
    if (from === "scan" && isCameraOn(session.state)) {
      session.stop();
    }
    if (from === "game") {
      gameChoice.save();
    }
  }

  // ---- Event wiring -------------------------------------------------------

  scanButton.addEventListener("click", () => {
    if (isCameraOn(session.state)) {
      session.stop();
    } else {
      sounds.unlock();
      debugPanel.clear();
      session.start();
    }
  });

  debugForceButton.addEventListener("click", () => session.forceDebugCapture());

  watchVideoFrameSize(video, (frameSize) => {
    // The actual negotiated resolution, which may differ from the requested one.
    resolutionStatus.textContent = `${frameSize.width} × ${frameSize.height}`;
    // index.html sizes the stage (and so the overlay canvas) from this.
    cameraStage.style.setProperty("--frame-aspect", String(frameSize.width / frameSize.height));
    if (session.state.phase === "scanning") {
      guide.redraw();
    }
  });

  window.addEventListener("pagehide", () => {
    // Also fires when entering the back-forward cache, where this JS state
    // survives; terminating the OCR worker keeps a restore from reusing a
    // dead one.
    session.stop();
    ocrWorker.terminate();
  });

  render(session.state);
  cameraSettings.populateCameras().then(
    () => render(session.state),
    (error: unknown) => session.showError(error, "Could not list cameras."),
  );
}

function statusMessage(state: ScanState): string {
  switch (state.phase) {
    case "stopped":
      return "Ready. Press Start Scan to detect a card.";
    case "starting":
      return "Starting camera…";
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

function scanButtonLabel(state: ScanState): string {
  if (state.phase === "starting") {
    return "Starting camera…";
  }
  return isCameraOn(state) ? "Stop Scan" : "Start Scan";
}

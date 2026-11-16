import { levenshteinDistance } from "../core";
import { CameraSettings } from "./cameraSettings";
import { CardOptions } from "./cardOptions";
import { DebugPanel } from "./debugSteps";
import { requireElement } from "./dom";
import { GameChoice } from "./gameChoice";
import type { GameSet } from "./gameConfig";
import { GuideFeedback } from "./guideFeedback";
import type { Identification } from "./identify";
import { IdentificationView } from "./identificationView";
import { ManualCardEntry } from "./manualEntry";
import { LazyOcrWorker } from "./ocr";
import { watchVideoFrameSize } from "./orientationWatcher";
import { loadPreferences, savePreferences } from "./preferences";
import { ResultView } from "./resultView";
import { ScannedCardList } from "./scannedCards";
import { isCameraOn, ScanSession } from "./scanSession";
import type { Capture, ScanState } from "./scanSession";
import { ScanSounds } from "./scanSounds";
import { ScreenNavigator } from "./screens";
import type { ScreenName } from "./screens";
import { SessionTagsInput } from "./sessionTags";
import { TelemetryPanel } from "./telemetryPanel";

const TAGS_ERROR = "Fix the session tags before adding the card.";

/** How long an auto-accepted capture's confirmation stays up before the next
 * scan starts — long enough for the user to see it and move the card out of
 * frame, so the same card isn't immediately auto-accepted again. */
const AUTO_ACCEPT_PAUSE_MS = 1500;

/** Wires the page to the scan session and the other shell modules, once the
 * games it starts with are loaded. Called once from src/main.ts. */
export async function initApp(): Promise<void> {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resolutionStatus = requireElement<HTMLElement>("resolution-status");
  const debugForceButton = requireElement<HTMLButtonElement>("debug-force-button");
  const captureFlash = requireElement<HTMLDivElement>("capture-flash");
  const holdStill = requireElement<HTMLElement>("hold-still");
  /** The identification behind the card currently shown, for the
   * OCR-vs-accepted telemetry (see acceptCard). */
  let shownIdentification: Identification | null = null;

  const gameChoice = await GameChoice.create(
    {
      gameSelect: requireElement("game-select"),
      setSelect: requireElement("set-select"),
      dialog: requireElement("game-dialog"),
      startButton: requireElement("game-dialog-start"),
      cancelButton: requireElement("game-dialog-cancel"),
      error: requireElement("game-dialog-error"),
    },
    (game) => cardOptions.applyGame(game),
    (set) => manualEntry.applySet(set),
    startScan,
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
  const scannedCards = await ScannedCardList.create(gameChoice.allGames, {
    list: requireElement("scanned-cards-list"),
    count: requireElement("scanned-cards-count"),
    emptyNote: requireElement("scanned-cards-empty"),
    storageError: requireElement("scanned-cards-error"),
    downloadButton: requireElement("scanned-cards-download"),
    mergeButton: requireElement("scanned-cards-merge"),
    clearButton: requireElement("scanned-cards-clear"),
  });
  const identificationView = new IdentificationView(
    {
      warning: requireElement("identification-warning"),
      setRow: requireElement("capture-set"),
      setSelect: requireElement("capture-set-select"),
      confidence: requireElement("identification-confidence"),
      matches: requireElement("identification-matches"),
    },
    acceptCard,
    rescan,
  );
  const manualEntry = new ManualCardEntry(
    {
      form: requireElement("manual-entry"),
      input: requireElement("manual-entry-input"),
      addButton: requireElement("manual-entry-add"),
      suggestions: requireElement("manual-entry-options"),
      error: requireElement("manual-entry-error"),
      autodetectHint: requireElement("manual-entry-hint"),
    },
    gameChoice.set,
    addScannedCard,
  );
  const debugPanel = new DebugPanel({
    panel: requireElement("debug-panel"),
    checkbox: requireElement("debug-checkbox"),
    controls: requireElement("debug-controls"),
  });
  const telemetryPanel = new TelemetryPanel({
    checkbox: requireElement("debug-checkbox"),
    panel: requireElement("telemetry-panel"),
    stats: requireElement("telemetry-stats"),
    resetButton: requireElement("telemetry-reset"),
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
      onDetectionStat: (events) => telemetryPanel.record(events),
    },
  );
  // The first launch opens on Help; later ones on Scan.
  const helpShown = loadPreferences().helpShown === true;
  if (!helpShown) {
    savePreferences({ helpShown: true });
  }
  const screens = new ScreenNavigator(
    {
      screens: {
        scan: requireElement("screen-scan"),
        settings: requireElement("screen-settings"),
        help: requireElement("screen-help"),
      },
      tabs: { scan: requireElement("tab-scan"), settings: requireElement("tab-settings"), help: requireElement("tab-help") },
    },
    helpShown ? "scan" : "help",
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
    holdStill.hidden = state.phase !== "processing";
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

  /** Shows the capture's thumbnail/flash/ping either way; when the best
   * match is confident enough (`autoAcceptCardId`), accepts it immediately
   * instead of waiting for the user to tap it. */
  function showCapture({ game, set, cardCanvas, identification, cycle, autoAcceptCardId }: Capture): void {
    resultView
      .show(cardCanvas, identification.collectorNumberCrop)
      .catch((error: unknown) => session.fail(error, "Could not encode the captured image.", cycle));
    captureFlash.animate([{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }], { duration: 300, iterations: 2 });
    shownIdentification = identification;
    if (autoAcceptCardId !== null) {
      sounds.bell();
      autoAccept(set, autoAcceptCardId, identification.collectorNumberConfidence);
      return;
    }
    sounds.ping();
    identificationView.show(game.sets, set, identification);
  }

  // ---- Cards --------------------------------------------------------------

  /** Records the card the user picked from the best matches and scans for
   * the next one. */
  function acceptCard(set: GameSet, cardId: string): void {
    const error = recordAcceptedCard(set, cardId);
    if (error !== null) {
      session.setCapturedMessage(error);
      return;
    }
    session.scanNext(`Added ${cardId} — scanning for the next card.`);
  }

  /** Records an auto-accepted card right away, but — unlike acceptCard —
   * waits AUTO_ACCEPT_PAUSE_MS before scanning again: with no one tapping a
   * match, the same still-in-frame card would otherwise get auto-accepted
   * over and over. */
  function autoAccept(set: GameSet, cardId: string, confidence: number): void {
    const error = recordAcceptedCard(set, cardId);
    if (error !== null) {
      session.setCapturedMessage(error);
      return;
    }
    session.setCapturedMessage(`Auto-accepted ${cardId} (${Math.round(confidence)}% confidence) — move the card away…`);
    setTimeout(() => {
      // The session may have been stopped or navigated away from during the pause.
      if (session.state.phase === "captured") {
        session.scanNext("Scanning for the next card.");
      }
    }, AUTO_ACCEPT_PAUSE_MS);
  }

  /** Adds the card and records its OCR-vs-accepted telemetry; returns an
   * error message, adding nothing, while the tags input holds invalid tags. */
  function recordAcceptedCard(set: GameSet, cardId: string): string | null {
    const error = addScannedCard(set, cardId);
    if (error !== null) {
      return error;
    }
    if (debugPanel.enabled && shownIdentification) {
      telemetryPanel.record([
        { metric: "ocrVsAcceptedDistance", value: levenshteinDistance(shownIdentification.collectorNumberText, cardId) },
      ]);
    }
    debugPanel.clear();
    return null;
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
    scannedCards.add(gameChoice.game, {
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
   * card while hidden. */
  function handleNavigate(from: ScreenName): void {
    if (session.state.phase === "starting") {
      throw new Error("Navigated away while the camera was starting.");
    }
    if (from === "scan" && isCameraOn(session.state)) {
      session.stop();
    }
  }

  // ---- Event wiring -------------------------------------------------------

  /** Runs when the user confirms the game dialog. */
  function startScan(): void {
    sounds.unlock();
    debugPanel.clear();
    session.start();
  }

  scanButton.addEventListener("click", () => {
    if (isCameraOn(session.state)) {
      session.stop();
    } else {
      gameChoice.open();
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

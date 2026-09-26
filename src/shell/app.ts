import { computeRegionPixelRects, selectBestFrame, STANDARD_CARD_ASPECT_RATIO, STANDARD_CARD_WIDTH_MM } from "../core";
import type { CardPrintFormat, FrameCandidate, OpenCv, PixelRegion, Size } from "../core";
import { createEdgeDetectionPool } from "../workers";
import type { EdgeDetectionPool } from "../workers";
import type { Worker as TesseractWorker } from "tesseract.js";
import { canvasToObjectURL, readQuadBoundingBoxPixels } from "./canvasUtils";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { listFullHdCameras } from "./cameraDevices";
import type { CameraOption } from "./cameraDevices";
import { captureFlattenedCard } from "./capture";
import { DEFAULT_CAMERA_RESOLUTION, resolutionOptionsForCamera } from "./config";
import {
  buildBurstFrameSteps,
  buildEdgeBandSteps,
  buildQuadOverlayStep,
  debugRejectionNote,
  debugStageHeading,
  renderDebugSteps,
} from "./debugSteps";
import type { DebugEntry } from "./debugSteps";
import { DetectionLoop } from "./detectionLoop";
import type { DetectionLoopResult } from "./detectionLoop";
import { collectBurstFrames } from "./frameBurst";
import type { FrameBurstResult } from "./frameBurst";
import { evaluateFrameForQuad } from "./frameDetection";
import type { AcceptedFrame, FrameEvaluation } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import { loadGameConfig } from "./gameConfig";
import {
  ALL_FOUND_FLASH_EDGE_COLORS,
  clearGuideOverlay,
  DEFAULT_GUIDE_EDGE_COLORS,
  drawGuideOverlay,
  edgeColorsForDetection,
  GUIDE_ALL_FOUND_FLASH_DURATION_MS,
} from "./guideOverlay";
import type { EdgeColors } from "./guideOverlay";
import { captureHiResStill } from "./hiResStill";
import { createOcrWorker, recognizeRegion } from "./ocr";
import { orientationFromSize, videoFrameSize, watchVideoOrientation } from "./orientationWatcher";
import { loadPreferences, savePreferences } from "./preferences";
import { cropRegion } from "./regionExtraction";
import { INITIAL_SCAN_STATE } from "./state";
import type { ScanState } from "./state";

/** The one bundled game config (no game selector yet). */
const IDENTIFICATION_GAME = "cyberpunk-2077-tcg";

interface RegionCrop {
  region: PixelRegion;
  canvas: HTMLCanvasElement;
}

/**
 * Wires every shell module to the page: DOM lookup, event handling and the
 * scan state machine. Called once from src/main.ts after OpenCV.js loads.
 */
export function initApp(cv: OpenCv): void {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const overlayCanvas = requireElement<HTMLCanvasElement>("guide-overlay");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resultSection = requireElement<HTMLElement>("result");
  const resultImage = requireElement<HTMLImageElement>("result-image");
  const identificationSection = requireElement<HTMLElement>("identification");
  const identificationStatus = requireElement<HTMLElement>("identification-status");
  const identificationResults = requireElement<HTMLDListElement>("identification-results");
  const formatSelect = requireElement<HTMLSelectElement>("format-select");
  const cameraSelect = requireElement<HTMLSelectElement>("camera-select");
  const resolutionSelect = requireElement<HTMLSelectElement>("resolution-select");
  const resolutionStatus = requireElement<HTMLElement>("resolution-status");
  const debugCheckbox = requireElement<HTMLInputElement>("debug-checkbox");
  const debugPanel = requireElement<HTMLElement>("debug-panel");
  const debugControls = requireElement<HTMLElement>("debug-controls");
  const debugForceButton = requireElement<HTMLButtonElement>("debug-force-button");

  let state: ScanState = INITIAL_SCAN_STATE;
  let cameraStatus: "stopped" | "starting" | "active" = "stopped";
  let pool: EdgeDetectionPool | null = null;
  let detectionLoop: DetectionLoop | null = null;
  /** Incremented whenever a scan cycle ends, so async work from an older
   * cycle can tell it is stale (see isCurrentScan). */
  let scanRequest = 0;

  /** Sticky for the session, not persisted. */
  let cardFormat: CardPrintFormat = "portrait";
  /** Read when a scan starts; toggling mid-scan applies to the next scan. */
  let debugEnabled = false;

  const preferences = loadPreferences();
  let cameras: CameraOption[] = [];
  let selectedCamera: CameraOption | null = null;
  /** The requested resolution; the camera may negotiate a different one. */
  let targetCameraResolution: Size = preferences.resolution ?? DEFAULT_CAMERA_RESOLUTION;

  /** Live guide feedback: the last frame's edges and the pending timer that
   * ends the all-edges-found flash. Reset per scan cycle. */
  let lastEdgesFound: [boolean, boolean, boolean, boolean] | null = null;
  let guideFlashTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** The `blob:` URL currently shown in resultImage, revoked when replaced. */
  let currentResultObjectUrl: string | null = null;

  /** Created lazily on first use and kept for the page's lifetime (expensive
   * to start, cheap to reuse); terminated on "pagehide". */
  let ocrWorker: TesseractWorker | null = null;
  let ocrWorkerPromise: Promise<TesseractWorker> | null = null;

  function getOcrWorker(): Promise<TesseractWorker> {
    ocrWorkerPromise ??= createOcrWorker().then((worker) => {
      ocrWorker = worker;
      return worker;
    });
    return ocrWorkerPromise;
  }

  function isCurrentScan(requestId: number): boolean {
    return requestId === scanRequest && cameraStatus === "active";
  }

  // ---- Rendering ----------------------------------------------------------

  function render(): void {
    statusEl.textContent = cameraStatus === "starting" ? "Starting camera…" : statusMessage(state);
    statusEl.dataset.kind = state.phase === "error" ? "error" : "";

    scanButton.disabled = cameraStatus === "starting" || cameras.length === 0;
    scanButton.textContent = scanButtonLabel(cameraStatus);
    resolutionSelect.disabled = cameraStatus === "starting";
    cameraSelect.disabled = cameraStatus === "starting" || cameras.length === 0;
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
    clearGuideOverlay(overlayCanvas);
    setState({ phase: "error", message: describeError(error, fallbackMessage) });
  }

  function drawGuide(edgeColors: EdgeColors): void {
    const frameSize = videoFrameSize(video);
    drawGuideOverlay(overlayCanvas, orientationFromSize(frameSize), frameSize, edgeColors, cardFormat);
  }

  function cancelGuideFlash(): void {
    if (guideFlashTimeoutHandle !== null) {
      clearTimeout(guideFlashTimeoutHandle);
      guideFlashTimeoutHandle = null;
    }
    lastEdgesFound = null;
  }

  function clearResultImage(): void {
    if (currentResultObjectUrl) {
      URL.revokeObjectURL(currentResultObjectUrl);
      currentResultObjectUrl = null;
    }
    resultImage.removeAttribute("src");
  }

  /** Shows `canvas` immediately as a `data:` URL, then swaps in a `blob:` URL
   * (openable at full resolution in a new tab). */
  function showResultImage(canvas: HTMLCanvasElement, requestId: number): void {
    clearResultImage();
    resultImage.src = canvas.toDataURL("image/png");
    canvasToObjectURL(canvas).then(
      (url) => {
        if (!isCurrentScan(requestId)) {
          URL.revokeObjectURL(url);
          return;
        }
        currentResultObjectUrl = url;
        resultImage.src = url;
      },
      (error: unknown) => failScan(error, "Could not encode the captured image.", requestId),
    );
  }

  function clearIdentificationResults(): void {
    identificationSection.hidden = true;
    identificationStatus.textContent = "";
    identificationResults.replaceChildren();
  }

  function showIdentificationResults(game: string, results: readonly { label: string; text: string }[]): void {
    identificationStatus.textContent = `Game: ${game}`;
    for (const result of results) {
      const dt = document.createElement("dt");
      dt.textContent = result.label;
      const dd = document.createElement("dd");
      dd.textContent = result.text || "(no text recognized)";
      identificationResults.append(dt, dd);
    }
  }

  // ---- Settings -----------------------------------------------------------

  function setCardFormat(format: CardPrintFormat): void {
    cardFormat = format;
    formatSelect.value = format;
  }

  /** Fills the resolution dropdown with the options `camera` supports and
   * selects the one matching `desired`, or the highest available. */
  function populateResolutionOptions(camera: CameraOption, desired: Size): void {
    const options = resolutionOptionsForCamera(camera.maxWidth, camera.maxHeight);
    resolutionSelect.replaceChildren(
      ...options.map((option) => {
        const el = document.createElement("option");
        el.value = resolutionOptionValue(option.size);
        el.textContent = option.label;
        return el;
      }),
    );
    const match = options.find((option) => resolutionOptionValue(option.size) === resolutionOptionValue(desired));
    targetCameraResolution = (match ?? options[options.length - 1]!).size;
    resolutionSelect.value = resolutionOptionValue(targetCameraResolution);
  }

  /** Probes cameras for Full HD support once at startup and fills the camera
   * dropdown, restoring the saved choice when it's still present. */
  async function populateCameraOptions(): Promise<void> {
    cameras = await listFullHdCameras();

    if (cameras.length === 0) {
      const el = document.createElement("option");
      el.value = "";
      el.textContent = "No Full HD camera found";
      cameraSelect.replaceChildren(el);
      resolutionSelect.replaceChildren();
      render();
      return;
    }

    cameraSelect.replaceChildren(
      ...cameras.map((camera) => {
        const el = document.createElement("option");
        el.value = camera.deviceId;
        el.textContent = camera.label;
        return el;
      }),
    );
    selectedCamera = cameras.find((c) => c.deviceId === preferences.cameraDeviceId) ?? cameras[0]!;
    cameraSelect.value = selectedCamera.deviceId;
    populateResolutionOptions(selectedCamera, targetCameraResolution);
    render();
  }

  /** getUserMedia constraints only apply at acquisition, so a camera or
   * resolution change restarts the running scan. */
  function restartScanIfActive(): void {
    if (cameraStatus === "active") {
      stopScan();
      void startScan();
    }
  }

  // ---- Scan lifecycle -----------------------------------------------------

  async function startScan(): Promise<void> {
    if (cameraStatus !== "stopped" || !selectedCamera) {
      return;
    }

    clearResultImage();
    clearIdentificationResults();
    debugPanel.replaceChildren();
    cameraStatus = "starting";
    setState({ phase: "idle" });
    try {
      await startCameraStream(video, targetCameraResolution, selectedCamera.deviceId);
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

  function beginScan(activePool: EdgeDetectionPool, requestId: number): void {
    const debug = debugEnabled;
    setState({ phase: "scanning" });
    cancelGuideFlash();
    drawGuide(DEFAULT_GUIDE_EDGE_COLORS);

    detectionLoop = new DetectionLoop(video, activePool);
    detectionLoop.start({
      onAccepted: (result) => {
        if (!isCurrentScan(requestId)) {
          return;
        }
        // The guide stays visible through "processing"; only the flash timer
        // needs cancelling now that the loop has stopped.
        cancelGuideFlash();
        void confirmAndCapture(activePool, result, requestId, debug);
      },
      onFrameEvaluated: (edgesFound) => handleFrameEvaluated(edgesFound, requestId),
      onError: (error) => failScan(error, "Card detection failed.", requestId),
    });
  }

  /**
   * Colors each guide edge by whether it was found in the latest frame, and
   * flashes the whole guide white for GUIDE_ALL_FOUND_FLASH_DURATION_MS when
   * all 4 edges first become found. While the flash is up, frames don't
   * repaint; the flash's timeout repaints with the latest result.
   */
  function handleFrameEvaluated(edgesFound: [boolean, boolean, boolean, boolean], requestId: number): void {
    if (!isCurrentScan(requestId)) {
      return;
    }
    const allFound = edgesFound.every(Boolean);
    const previouslyAllFound = lastEdgesFound?.every(Boolean) ?? false;
    lastEdgesFound = edgesFound;

    if (allFound && !previouslyAllFound) {
      if (guideFlashTimeoutHandle !== null) {
        clearTimeout(guideFlashTimeoutHandle);
      }
      drawGuide(ALL_FOUND_FLASH_EDGE_COLORS);
      guideFlashTimeoutHandle = setTimeout(() => {
        guideFlashTimeoutHandle = null;
        if (isCurrentScan(requestId) && state.phase === "scanning" && lastEdgesFound) {
          drawGuide(edgeColorsForDetection(lastEdgesFound));
        }
      }, GUIDE_ALL_FOUND_FLASH_DURATION_MS);
      return;
    }

    if (guideFlashTimeoutHandle === null) {
      drawGuide(edgeColorsForDetection(edgesFound));
    }
  }

  /**
   * After the preview frame is accepted: collect a burst of accepted frames,
   * flatten only the best one (or the preview frame if the burst found none),
   * show it and identify the card.
   */
  async function confirmAndCapture(
    activePool: EdgeDetectionPool,
    preview: DetectionLoopResult,
    requestId: number,
    debug: boolean,
  ): Promise<void> {
    try {
      setState({ phase: "processing" });

      const burst = await collectBurstFrames(video, activePool, debug, () => !isCurrentScan(requestId));
      if (!isCurrentScan(requestId)) {
        return;
      }

      const selected = selectFrameToFlatten(burst.accepted, preview.frame);
      const cardCanvas = captureFlattenedCard(cv, selected, cardFormat);
      showResultImage(cardCanvas, requestId);

      const regionCrops = await identifyCard(cardCanvas, requestId);
      if (!isCurrentScan(requestId)) {
        return;
      }

      if (debug) {
        renderDebugSteps(debugPanel, buildCaptureDebugTrail(preview, burst, selected, cardCanvas, regionCrops));
      }
      clearGuideOverlay(overlayCanvas);
      setState({ phase: "captured" });
    } catch (error: unknown) {
      failScan(error, "Capture failed.", requestId);
    }
  }

  /**
   * Crops every configured region out of the card, OCRs the text regions and
   * shows the results (no dataset matching yet). Returns the crops for the
   * debug trail. Stops early, without rendering, if the scan becomes stale.
   */
  async function identifyCard(cardCanvas: HTMLCanvasElement, requestId: number): Promise<RegionCrop[]> {
    identificationSection.hidden = false;
    identificationStatus.textContent = "Identifying…";
    identificationResults.replaceChildren();

    const gameConfig = loadGameConfig(IDENTIFICATION_GAME);
    const crops = computeRegionPixelRects(gameConfig.regions, cardCanvas).map((region) => ({
      region,
      canvas: cropRegion(cardCanvas, region),
    }));
    const cardPxPerMm = cardCanvas.width / STANDARD_CARD_WIDTH_MM;
    const worker = await getOcrWorker();

    const results: { label: string; text: string }[] = [];
    for (const { region, canvas } of crops) {
      if (!isCurrentScan(requestId)) {
        return crops;
      }
      if (region.type === "text") {
        const { filteredText } = await recognizeRegion(worker, canvas, cardPxPerMm, region.allowedCharsRegex);
        results.push({ label: region.label, text: filteredText });
      }
    }

    if (isCurrentScan(requestId)) {
      showIdentificationResults(gameConfig.game, results);
    }
    return crops;
  }

  function stopScan(): void {
    releaseScanResources();
    clearGuideOverlay(overlayCanvas);
    clearResultImage();
    clearIdentificationResults();
    resolutionStatus.textContent = "-";
    setState({ phase: "idle" });
  }

  function releaseScanResources(): void {
    scanRequest += 1;
    cancelGuideFlash();
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
        renderForcedDebugEvaluation(evaluation, "Live preview frame"),
      );
      return;
    }

    const frameSize: Size = { width: still.width, height: still.height };
    const evaluation = await evaluateFrameForQuad(new FrameSampler(), pool, still, frameSize);
    if (isCurrentScan(requestId)) {
      renderForcedDebugEvaluation(evaluation, `Hi-res still — ${frameSize.width} × ${frameSize.height}`);
    }
  }

  function renderForcedDebugEvaluation(evaluation: FrameEvaluation, heading: string): void {
    renderDebugSteps(debugPanel, [
      debugStageHeading(heading),
      ...(evaluation.status === "rejected" ? [debugRejectionNote(evaluation.reason)] : []),
      ...buildEdgeBandSteps(evaluation.bands, evaluation.lines),
    ]);
  }

  // ---- Event wiring -------------------------------------------------------

  debugCheckbox.addEventListener("change", () => {
    debugEnabled = debugCheckbox.checked;
    debugPanel.hidden = !debugEnabled;
    debugControls.hidden = !debugEnabled;
    if (!debugEnabled) {
      debugPanel.replaceChildren();
    }
  });

  debugForceButton.addEventListener("click", () => {
    const requestId = scanRequest;
    handleDebugForceCapture(requestId).catch((error: unknown) => failScan(error, "Debug capture failed.", requestId));
  });

  formatSelect.addEventListener("change", () => setCardFormat(parseCardPrintFormat(formatSelect.value)));

  resolutionSelect.addEventListener("change", () => {
    if (!selectedCamera) {
      throw new Error("Resolution changed with no camera selected.");
    }
    const selected = resolutionOptionsForCamera(selectedCamera.maxWidth, selectedCamera.maxHeight).find(
      (option) => resolutionOptionValue(option.size) === resolutionSelect.value,
    );
    if (!selected) {
      throw new Error(`Unknown resolution option: ${resolutionSelect.value}`);
    }
    targetCameraResolution = selected.size;
    savePreferences({ cameraDeviceId: selectedCamera.deviceId, resolution: targetCameraResolution });
    restartScanIfActive();
  });

  cameraSelect.addEventListener("change", () => {
    const camera = cameras.find((c) => c.deviceId === cameraSelect.value);
    if (!camera) {
      throw new Error(`Unknown camera option: ${cameraSelect.value}`);
    }
    selectedCamera = camera;
    populateResolutionOptions(camera, targetCameraResolution);
    savePreferences({ cameraDeviceId: camera.deviceId, resolution: targetCameraResolution });
    restartScanIfActive();
  });

  scanButton.addEventListener("click", () => {
    if (cameraStatus === "active") {
      stopScan();
    } else {
      void startScan();
    }
  });

  watchVideoOrientation(video, (_orientation, frameSize) => {
    // The actual negotiated resolution, which may differ from the requested one.
    resolutionStatus.textContent = `${frameSize.width} × ${frameSize.height}`;
    // Keeps the overlay canvas's CSS box matching the video's frame shape.
    cameraStage.style.aspectRatio = `${frameSize.width} / ${frameSize.height}`;
    if (state.phase === "scanning") {
      drawGuide(DEFAULT_GUIDE_EDGE_COLORS);
    }
  });

  window.addEventListener("pagehide", () => {
    // Also fires when entering the back-forward cache, where this JS state
    // survives; releasing (not just terminating) resources ensures a restore
    // doesn't keep a dead pool around.
    releaseScanResources();
    clearGuideOverlay(overlayCanvas);
    render();
    void ocrWorker?.terminate();
  });

  setCardFormat(cardFormat);
  setState(INITIAL_SCAN_STATE);
  void populateCameraOptions();
}

/** The best accepted burst frame, or `fallback` if the burst accepted none. */
function selectFrameToFlatten(accepted: readonly AcceptedFrame[], fallback: AcceptedFrame): AcceptedFrame {
  const candidates = accepted.length > 0 ? accepted : [fallback];
  return selectBestFrame(candidates.map(toFrameCandidate), STANDARD_CARD_ASPECT_RATIO);
}

function toFrameCandidate(frame: AcceptedFrame): AcceptedFrame & FrameCandidate {
  return { ...frame, cardPixels: readQuadBoundingBoxPixels(frame.frameCanvas, frame.corners) };
}

/** The debug trail for one capture, top to bottom: the preview detection,
 * every burst frame, the selected frame, the flattened card and its regions. */
function buildCaptureDebugTrail(
  preview: DetectionLoopResult,
  burst: FrameBurstResult,
  selected: AcceptedFrame,
  cardCanvas: HTMLCanvasElement,
  regionCrops: readonly RegionCrop[],
): DebugEntry[] {
  return [
    ...buildEdgeBandSteps(preview.bands, preview.lines),
    buildQuadOverlayStep(preview.frame.frameCanvas, preview.frame.corners, "Detected quad"),
    debugStageHeading(`Burst capture — ${burst.accepted.length}/${burst.debugFrames.length} usable`),
    ...buildBurstFrameSteps(burst.debugFrames),
    buildQuadOverlayStep(selected.frameCanvas, selected.corners, "Selected frame"),
    { label: "Flattened output", canvas: cardCanvas },
    ...regionCrops.map(({ region, canvas }) => ({ label: `Region: ${region.label}`, canvas })),
  ];
}

function statusMessage(state: ScanState): string {
  switch (state.phase) {
    case "idle":
      return "Ready. Press Start Scan to detect a card.";
    case "scanning":
      return "Scanning — align the card with the guide.";
    case "processing":
      return "Card detected — hold it still…";
    case "captured":
      return "Card captured.";
    case "error":
      return state.message ?? "Something went wrong.";
  }
}

function scanButtonLabel(cameraStatus: "stopped" | "starting" | "active"): string {
  switch (cameraStatus) {
    case "starting":
      return "Starting camera…";
    case "active":
      return "Stop Scan";
    case "stopped":
      return "Start Scan";
  }
}

function parseCardPrintFormat(value: string): CardPrintFormat {
  if (value === "portrait" || value === "landscape") {
    return value;
  }
  throw new Error(`Unexpected card print format: ${value}`);
}

/** The resolution `<option value>` for a size. */
function resolutionOptionValue(size: Size): string {
  return `${size.width}x${size.height}`;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected an element with id="${id}" in index.html.`);
  }
  return el as T;
}

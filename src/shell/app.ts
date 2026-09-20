import type { CardPrintFormat, OpenCv, Orientation, Size } from "../core";
import { createEdgeDetectionPool } from "../workers";
import type { EdgeDetectionPool } from "../workers";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { captureFlattenedCard } from "./capture";
import { DetectionLoop } from "./detectionLoop";
import { clearGuideOverlay, drawGuideOverlay } from "./guideOverlay";
import { watchVideoOrientation } from "./orientationWatcher";
import { INITIAL_SCAN_STATE } from "./state";
import type { ScanState } from "./state";

/**
 * Wires together every src/shell module into the actual page: DOM element
 * lookup, event handling, and the scan state machine. This is the one
 * "impure orchestration" file that's allowed to know about all the other
 * shell pieces and the concrete `index.html` markup; every other shell
 * module stays focused on its one concern (camera, orientation, overlay,
 * the frame loop, capture) and doesn't know about the DOM structure as a
 * whole.
 *
 * Called once from src/main.ts after OpenCV.js has finished initializing.
 */
export function initApp(cv: OpenCv): void {
  const video = requireElement<HTMLVideoElement>("camera-video");
  const overlayCanvas = requireElement<HTMLCanvasElement>("guide-overlay");
  const cameraStage = requireElement<HTMLDivElement>("camera-stage");
  const statusEl = requireElement<HTMLParagraphElement>("status");
  const scanButton = requireElement<HTMLButtonElement>("scan-button");
  const resultSection = requireElement<HTMLElement>("result");
  const resultImage = requireElement<HTMLImageElement>("result-image");
  const formatPortraitButton = requireElement<HTMLButtonElement>("format-portrait");
  const formatLandscapeButton = requireElement<HTMLButtonElement>("format-landscape");

  let state: ScanState = INITIAL_SCAN_STATE;
  let cameraAvailable = false;
  let pool: EdgeDetectionPool | null = null;
  let detectionLoop: DetectionLoop | null = null;

  // Sticky for the session per the plan's UX flow: stays set across scans
  // until the user explicitly changes it, in-memory only (no persistence
  // requirement beyond "until the page reloads").
  let cardFormat: CardPrintFormat = "portrait";

  let latestOrientation: Orientation | null = null;
  let latestFrameSize: Size | null = null;

  function render(): void {
    statusEl.textContent =
      state.phase === "idle" && !cameraAvailable ? "Starting camera…" : statusMessage(state);
    statusEl.dataset.kind = state.phase === "error" ? "error" : "";

    const busy = state.phase === "scanning" || state.phase === "processing";
    scanButton.disabled = !cameraAvailable || busy;
    scanButton.textContent = scanButtonLabel(state.phase);

    resultSection.hidden = state.phase !== "captured";
    cameraStage.hidden = state.phase === "captured";
  }

  function setState(next: ScanState): void {
    state = next;
    render();
  }

  function setCardFormat(format: CardPrintFormat): void {
    cardFormat = format;
    formatPortraitButton.setAttribute("aria-pressed", String(format === "portrait"));
    formatLandscapeButton.setAttribute("aria-pressed", String(format === "landscape"));
  }

  formatPortraitButton.addEventListener("click", () => setCardFormat("portrait"));
  formatLandscapeButton.addEventListener("click", () => setCardFormat("landscape"));

  scanButton.addEventListener("click", () => {
    if (!cameraAvailable || state.phase === "scanning" || state.phase === "processing") {
      return;
    }
    if (!pool) {
      // Lazily created on the first Scan press rather than eagerly at
      // camera-start, so a user who never presses Scan never pays the 4x
      // OpenCV.js/WASM worker warm-up cost.
      pool = createEdgeDetectionPool();
    }
    if (state.phase === "captured") {
      resultImage.removeAttribute("src");
    }
    beginScan(pool);
  });

  function beginScan(activePool: EdgeDetectionPool): void {
    setState({ phase: "scanning" });
    if (latestOrientation && latestFrameSize) {
      drawGuideOverlay(overlayCanvas, latestOrientation, latestFrameSize);
    }

    detectionLoop = new DetectionLoop(video, activePool);
    detectionLoop.start((result) => {
      clearGuideOverlay(overlayCanvas);
      setState({ phase: "processing" });

      captureFlattenedCard({
        cv,
        video,
        previewCorners: result.corners,
        previewFrameSize: result.frameSize,
        camera: latestOrientation ?? "portrait",
        cardFormat,
      })
        .then((output) => {
          resultImage.src = output.canvas.toDataURL("image/png");
          setState({ phase: "captured" });
        })
        .catch((error: unknown) => {
          console.error("Capture failed.", error);
          setState({ phase: "error", message: describeError(error, "Capture failed.") });
        });
    });
  }

  watchVideoOrientation(video, (orientation, frameSize) => {
    latestOrientation = orientation;
    latestFrameSize = frameSize;
    // Keep the camera-stage container's aspect ratio matching the video's
    // actual intrinsic frame shape, so the guide-overlay canvas (sized to
    // that same frame in guideOverlay.ts) lines up pixel-for-pixel with the
    // video underneath it — see drawGuideOverlay's doc comment.
    cameraStage.style.aspectRatio = `${frameSize.width} / ${frameSize.height}`;
    if (state.phase === "scanning") {
      drawGuideOverlay(overlayCanvas, orientation, frameSize);
    }
  });

  setState(INITIAL_SCAN_STATE);

  startCameraStream(video)
    .then(() => {
      cameraAvailable = true;
      render();
    })
    .catch((error: unknown) => {
      console.error("Camera setup failed.", error);
      setState({ phase: "error", message: describeError(error, "Could not start the camera.") });
    });

  window.addEventListener("pagehide", () => {
    detectionLoop?.stop();
    pool?.terminate();
    stopCameraStream(video);

    // "pagehide" isn't only fired on a full unload — it also fires when the
    // page enters the browser's back-forward cache (e.g. a mobile user
    // backgrounds the tab), and such a page can later be restored via
    // "pageshow" with this same JS execution state intact rather than
    // reloaded. Without clearing these, a bfcache restore would see a
    // stale-but-truthy `pool` (already terminated above) and never
    // recreate it, leaving every detectEdges() call rejecting forever and
    // the detection loop's per-frame catch silently retrying forever — an
    // unrecoverable "stuck scanning" UI with no full reload in sight. This
    // doesn't implement a real bfcache-restore flow (no "pageshow"
    // handler re-starts the camera) — it just ensures the state left
    // behind isn't silently broken if a restore does happen.
    detectionLoop = null;
    pool = null;
    cameraAvailable = false;
    render();
  });
}

function statusMessage(state: ScanState): string {
  switch (state.phase) {
    case "idle":
      return "Ready. Press Scan to detect a card.";
    case "scanning":
      return "Scanning — align the card with the guide.";
    case "processing":
      return "Capturing…";
    case "captured":
      return "Card captured.";
    case "error":
      return state.message ?? "Something went wrong.";
  }
}

function scanButtonLabel(phase: ScanState["phase"]): string {
  switch (phase) {
    case "scanning":
      return "Scanning…";
    case "processing":
      return "Capturing…";
    case "captured":
      return "Scan Again";
    default:
      return "Scan";
  }
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

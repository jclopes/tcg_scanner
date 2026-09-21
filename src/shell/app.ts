import {
  CAPTURE_BURST_FRAME_COUNT,
  CAPTURE_BURST_MIN_USABLE_FRAMES,
  CAPTURE_BURST_HARD_LIMIT,
  selectBestFrame,
  STANDARD_CARD_ASPECT_RATIO,
} from "../core";
import type { CardPrintFormat, OpenCv, Orientation, RgbaPixelBuffer, Size } from "../core";
import { createEdgeDetectionPool } from "../workers";
import type { EdgeDetectionPool } from "../workers";
import { canvasToObjectURL } from "./canvasUtils";
import { startCameraStream, stopCameraStream } from "./cameraStream";
import { captureFlattenedCard } from "./capture";
import { CAMERA_RESOLUTION_OPTIONS, DEFAULT_CAMERA_RESOLUTION } from "./config";
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
import type { DetectionLoopResult, ForcedDebugSnapshot } from "./detectionLoop";
import { captureFlattenedFrameBurst } from "./flattenedFrameBurst";
import type { BurstFrameDebugEntry } from "./flattenedFrameBurst";
import {
  clearGuideOverlay,
  drawGuideOverlay,
  edgeColorsForDetection,
  GUIDE_ALL_FOUND_FLASH_DURATION_MS,
  GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
} from "./guideOverlay";
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
  const formatSelect = requireElement<HTMLSelectElement>("format-select");
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
  let scanRequest = 0;

  // Sticky for the session per the plan's UX flow: stays set across scans
  // until the user explicitly changes it, in-memory only (no persistence
  // requirement beyond "until the page reloads").
  let cardFormat: CardPrintFormat = "portrait";

  // Also sticky — the *requested* camera resolution (see
  // CAMERA_RESOLUTION_OPTIONS' doc comment for why the camera's actual
  // negotiated resolution, shown in resolutionStatus, can end up different
  // from this).
  let targetCameraResolution: Size = DEFAULT_CAMERA_RESOLUTION;

  let latestOrientation: Orientation | null = null;
  let latestFrameSize: Size | null = null;

  // Live per-edge guide feedback (see handleFrameEvaluated): the most
  // recently drawn detection result, and the pending "revert from the
  // all-found white flash back to steady-state colors" timer, if one's
  // currently running. Both reset per scan cycle (beginScan/
  // releaseScanResources) so a stale cycle's timer can never fire against a
  // newer one's overlay.
  let lastEdgesFound: [boolean, boolean, boolean, boolean] | null = null;
  let guideFlashTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function cancelGuideFlash(): void {
    if (guideFlashTimeoutHandle !== null) {
      clearTimeout(guideFlashTimeoutHandle);
      guideFlashTimeoutHandle = null;
    }
    lastEdgesFound = null;
  }

  // The `blob:` object URL (see canvasToObjectURL) currently backing
  // resultImage.src, if any — tracked so it can be revoked whenever it's
  // about to be replaced or is no longer shown, rather than leaking each
  // capture's (potentially several-MB) image data for the rest of the
  // page's lifetime.
  let currentResultObjectUrl: string | null = null;

  function clearResultImage(): void {
    if (currentResultObjectUrl) {
      URL.revokeObjectURL(currentResultObjectUrl);
      currentResultObjectUrl = null;
    }
    resultImage.removeAttribute("src");
  }

  // A scan cycle spans an awaited async flatten step; this is checked
  // afterward so a stale cycle (the user stopped/restarted the scan while
  // it was in flight) doesn't touch UI state or resources a newer cycle now
  // owns.
  function isCurrentScan(requestId: number): boolean {
    return requestId === scanRequest && cameraStatus === "active";
  }

  // Captured once per scan cycle at startScan() time (per the debug
  // feature's "only for the full cycle" scope) — toggling mid-scan takes
  // effect on the next scan, not retroactively.
  let debugEnabled = false;
  debugCheckbox.addEventListener("change", () => {
    debugEnabled = debugCheckbox.checked;
    debugPanel.hidden = !debugEnabled;
    debugControls.hidden = !debugEnabled;
    if (!debugEnabled) {
      debugPanel.replaceChildren();
    }
  });

  // Forces a one-off debug capture of whichever frame the loop evaluates
  // next, showing what each edge did and didn't detect — independent of
  // (and without disturbing) the loop's own accept/reject flow. Only
  // meaningful while a scan is actually running (detectionLoop is set);
  // render() keeps the button disabled otherwise.
  debugForceButton.addEventListener("click", () => {
    detectionLoop?.requestForcedDebugCapture((snapshot: ForcedDebugSnapshot) => {
      const entries: DebugEntry[] = [];
      if (snapshot.rejectionReason) {
        entries.push(debugRejectionNote(snapshot.rejectionReason));
      }
      entries.push(...buildEdgeBandSteps(snapshot.bands, snapshot.lines));
      renderDebugSteps(debugPanel, entries);
    });
  });

  function render(): void {
    statusEl.textContent = cameraStatus === "starting" ? "Starting camera…" : statusMessage(state);
    statusEl.dataset.kind = state.phase === "error" ? "error" : "";

    scanButton.disabled = cameraStatus === "starting";
    scanButton.textContent = scanButtonLabel(cameraStatus);
    resolutionSelect.disabled = cameraStatus === "starting";

    debugForceButton.disabled = cameraStatus !== "active";

    resultSection.hidden = state.phase !== "captured";
  }

  function setState(next: ScanState): void {
    state = next;
    render();
  }

  function setCardFormat(format: CardPrintFormat): void {
    cardFormat = format;
    formatSelect.value = format;
  }

  formatSelect.addEventListener("change", () => setCardFormat(parseCardPrintFormat(formatSelect.value)));
  setCardFormat(cardFormat);

  for (const option of CAMERA_RESOLUTION_OPTIONS) {
    const el = document.createElement("option");
    el.value = resolutionOptionValue(option.size);
    el.textContent = option.label;
    resolutionSelect.append(el);
  }
  resolutionSelect.value = resolutionOptionValue(targetCameraResolution);

  // Changing resolution while the camera's already running restarts the
  // whole scan cycle with the new target — getUserMedia constraints are
  // only applied at acquisition time, and re-acquiring (permission's
  // already granted, so this is fast) is simpler and more reliable across
  // devices than trying to renegotiate an already-flowing track in place.
  resolutionSelect.addEventListener("change", () => {
    const selected = CAMERA_RESOLUTION_OPTIONS.find(
      (option) => resolutionOptionValue(option.size) === resolutionSelect.value,
    );
    if (!selected) {
      return;
    }
    targetCameraResolution = selected.size;
    if (cameraStatus === "active") {
      stopScan();
      void startScan();
    }
  });

  scanButton.addEventListener("click", () => {
    if (cameraStatus === "active") {
      stopScan();
      return;
    }
    void startScan();
  });

  async function startScan(): Promise<void> {
    if (cameraStatus !== "stopped") {
      return;
    }

    clearResultImage();
    debugPanel.replaceChildren();
    cameraStatus = "starting";
    setState({ phase: "idle" });
    try {
      await startCameraStream(video, targetCameraResolution);
      cameraStatus = "active";
      if (!pool) {
        pool = createEdgeDetectionPool();
      }
      beginScan(pool, ++scanRequest);
    } catch (error: unknown) {
      cameraStatus = "stopped";
      stopCameraStream(video);
      setState({ phase: "error", message: describeError(error, "Could not start the camera.") });
    }
  }

  function beginScan(activePool: EdgeDetectionPool, requestId: number): void {
    setState({ phase: "scanning" });
    cancelGuideFlash();
    if (latestOrientation && latestFrameSize) {
      drawGuideOverlay(overlayCanvas, latestOrientation, latestFrameSize, undefined, cardFormat);
    }

    detectionLoop = new DetectionLoop(video, activePool, debugEnabled);
    detectionLoop.start(
      (result) => {
        if (!isCurrentScan(requestId)) {
          return;
        }
        // Deliberately *not* clearing the guide overlay here (unlike
        // before) — it should stay visible through the capture attempt
        // ("processing"), not just while actively searching for a quad.
        // cancelGuideFlash() alone is still needed: the loop has stopped,
        // so no more handleFrameEvaluated calls are coming to naturally
        // supersede a pending flash-revert timeout.
        cancelGuideFlash();
        void confirmAndCapture(activePool, result, requestId);
      },
      (edgesFound) => {
        handleFrameEvaluated(edgesFound, requestId);
      },
    );
  }

  /**
   * Live per-edge feedback on the guide overlay: colors each of the 4 guide
   * lines according to whether *that* edge was found in the most recently
   * evaluated frame (red) or not (green — the guide's original, only
   * color before this existed), and briefly flashes the whole guide white
   * when a frame finds all 4 at once, before settling back to steady-state
   * colors — a "getting close" signal distinct from actual acceptance
   * (which stops the loop and clears the overlay entirely; this can still
   * fire on a frame that finds every edge but whose quad fails
   * `validateQuad`, e.g. a slightly-off aspect ratio).
   *
   * Only re-triggers the flash on the frame where all-4-found first becomes
   * true, not on every subsequent still-all-found frame (detection commonly
   * stays all-found across many consecutive frames while the card's held
   * steady, and re-flashing on each one would just look like white staying
   * on continuously rather than a single half-second blink).
   */
  function handleFrameEvaluated(edgesFound: [boolean, boolean, boolean, boolean], requestId: number): void {
    if (!isCurrentScan(requestId) || !latestOrientation || !latestFrameSize) {
      return;
    }
    const orientation = latestOrientation;
    const frameSize = latestFrameSize;

    const allFound = edgesFound.every(Boolean);
    const previouslyAllFound = lastEdgesFound?.every(Boolean) ?? false;
    lastEdgesFound = edgesFound;

    if (allFound && !previouslyAllFound) {
      if (guideFlashTimeoutHandle !== null) {
        clearTimeout(guideFlashTimeoutHandle);
      }
      drawGuideOverlay(overlayCanvas, orientation, frameSize, [
        GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
        GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
        GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
        GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
      ], cardFormat);
      guideFlashTimeoutHandle = setTimeout(() => {
        guideFlashTimeoutHandle = null;
        if (!isCurrentScan(requestId) || state.phase !== "scanning" || !lastEdgesFound) {
          return;
        }
        drawGuideOverlay(overlayCanvas, orientation, frameSize, edgeColorsForDetection(lastEdgesFound), cardFormat);
      }, GUIDE_ALL_FOUND_FLASH_DURATION_MS);
      return;
    }

    if (guideFlashTimeoutHandle !== null) {
      // A flash is still showing white — leave it up rather than painting
      // over it, whether this frame is still all-found (nothing new to
      // show yet) or has since lost an edge (the flash's own timeout will
      // redraw with this frame's now-stale colors when it fires; simplest
      // to just let that happen rather than racing it here).
      return;
    }

    drawGuideOverlay(overlayCanvas, orientation, frameSize, edgeColorsForDetection(edgesFound), cardFormat);
  }

  /**
   * Runs after a quad is first accepted on a preview frame: rather than
   * committing to that exact frame, captures frames in bursts (up to
   * CAPTURE_BURST_HARD_LIMIT total) until at least CAPTURE_BURST_MIN_USABLE_FRAMES
   * are successfully detected+flattened. Each frame is processed the same way
   * the preview frame was. Once enough frames are gathered, `selectBestFrame`
   * picks the single best (sharpest, closest card-aspect-ratio match).
   *
   * If the hard limit is reached without capturing enough usable frames,
   * shows an error and restarts scanning. If fewer frames than the burst size
   * are captured in any single attempt (e.g. the card moved out of frame),
   * the loop retries with another burst attempt.
   *
   * When debug mode is on, the debug panel shows the preview detection that
   * triggered the burst, every burst frame attempted (marked captured or
   * why it was rejected), and the final flattened output.
   */
  async function confirmAndCapture(
    activePool: EdgeDetectionPool,
    previewResult: DetectionLoopResult,
    requestId: number,
  ): Promise<void> {
    try {
      setState({ phase: "processing" });

      const debugEntries: DebugEntry[] = [];
      if (previewResult.debug) {
        debugEntries.push(...buildEdgeBandSteps(previewResult.debug.bands, previewResult.debug.lines));
        debugEntries.push(buildQuadOverlayStep(previewResult.frameCanvas, previewResult.corners));
      }

      const camera = latestOrientation ?? "portrait";

      // Capture in bursts until we have enough usable frames or hit the hard limit
      const allBurst: RgbaPixelBuffer[] = [];
      const allDebugFrames: BurstFrameDebugEntry[] = [];
      let totalFramesCaptured = 0;

      while (allBurst.length < CAPTURE_BURST_MIN_USABLE_FRAMES && totalFramesCaptured < CAPTURE_BURST_HARD_LIMIT) {
        const remainingFrameBudget = CAPTURE_BURST_HARD_LIMIT - totalFramesCaptured;
        const framesThisBurst = Math.min(CAPTURE_BURST_FRAME_COUNT, remainingFrameBudget);

        const { flattened: burst, debugFrames } = await captureFlattenedFrameBurst(
          video,
          activePool,
          cv,
          framesThisBurst,
          camera,
          cardFormat,
          debugEnabled,
        );
        if (!isCurrentScan(requestId)) {
          return;
        }

        allBurst.push(...burst);
        if (debugFrames) {
          allDebugFrames.push(...debugFrames);
        }
        totalFramesCaptured += framesThisBurst;
      }

      if (debugEntries.length > 0 && allDebugFrames.length > 0) {
        debugEntries.push(debugStageHeading(`Burst capture — ${allBurst.length}/${allDebugFrames.length} usable`));
        debugEntries.push(...buildBurstFrameSteps(allDebugFrames));
      }

      let outputCanvas: HTMLCanvasElement;
      if (allBurst.length >= CAPTURE_BURST_MIN_USABLE_FRAMES) {
        // We have enough frames to pick from
        outputCanvas = rgbaBufferToCanvas(selectBestFrame(allBurst, STANDARD_CARD_ASPECT_RATIO));
      } else if (allBurst.length > 0) {
        // We hit the hard limit but still have *some* frames — use the best of what we got
        outputCanvas = rgbaBufferToCanvas(selectBestFrame(allBurst, STANDARD_CARD_ASPECT_RATIO));
      } else {
        // No usable frames at all — fall back to the preview frame
        const fallback = await captureFlattenedCard({
          cv,
          frameCanvas: previewResult.frameCanvas,
          corners: previewResult.corners,
          camera,
          cardFormat,
        });
        if (!isCurrentScan(requestId)) {
          return;
        }
        outputCanvas = fallback.canvas;
      }

      // Immediate data: URL placeholder, then swapped to a blob: object URL
      // once ready — see canvasToObjectURL's doc comment for why the swap
      // matters (a full-resolution capture's data: URL can be long enough
      // that browsers refuse to navigate to it, e.g. via a right-click
      // "open image in new tab").
      resultImage.src = outputCanvas.toDataURL("image/png");
      void canvasToObjectURL(outputCanvas).then((url) => {
        if (!url) {
          return;
        }
        if (!isCurrentScan(requestId)) {
          // A newer scan has already started (or this one was stopped) by
          // the time the blob was ready — nothing left to show it in, so
          // just free it immediately rather than leaking it.
          URL.revokeObjectURL(url);
          return;
        }
        if (currentResultObjectUrl) {
          URL.revokeObjectURL(currentResultObjectUrl);
        }
        currentResultObjectUrl = url;
        resultImage.src = url;
      });
      if (debugEntries.length > 0) {
        debugEntries.push({ label: "Flattened output", canvas: outputCanvas });
        renderDebugSteps(debugPanel, debugEntries);
      }
      clearGuideOverlay(overlayCanvas);
      setState({ phase: "captured" });
    } catch (error: unknown) {
      if (!isCurrentScan(requestId)) {
        return;
      }
      console.error("Capture failed.", error);
      clearGuideOverlay(overlayCanvas);
      setState({ phase: "error", message: describeError(error, "Capture failed.") });
    }
  }

  function stopScan(): void {
    releaseScanResources();
    clearGuideOverlay(overlayCanvas);
    clearResultImage();
    resolutionStatus.textContent = "Resolution: —";
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

  watchVideoOrientation(video, (orientation, frameSize) => {
    latestOrientation = orientation;
    latestFrameSize = frameSize;
    // The camera's *actual* negotiated resolution — may differ from
    // targetCameraResolution, since it's requested as `ideal` (see
    // CAMERA_RESOLUTION_OPTIONS' doc comment).
    resolutionStatus.textContent = `Resolution: ${frameSize.width} × ${frameSize.height}`;
    // Keep the camera-stage container's aspect ratio matching the video's
    // actual intrinsic frame shape, so the guide-overlay canvas (sized to
    // that same frame in guideOverlay.ts) lines up pixel-for-pixel with the
    // video underneath it — see drawGuideOverlay's doc comment.
    cameraStage.style.aspectRatio = `${frameSize.width} / ${frameSize.height}`;
    if (state.phase === "scanning") {
      drawGuideOverlay(overlayCanvas, orientation, frameSize, undefined, cardFormat);
    }
  });

  setState(INITIAL_SCAN_STATE);

  window.addEventListener("pagehide", () => {
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
    releaseScanResources();
    clearGuideOverlay(overlayCanvas);
    render();
  });
}

/** Draws a plain `RgbaPixelBuffer` (e.g. `selectBestFrame`'s pick from a
 * burst) onto a fresh canvas — burst frames are read back as raw pixel
 * buffers (see captureFlattenedFrameBurst's `canvasToRgbaBuffer`) so they
 * can be scored by `laplacianVariance` without keeping a canvas per frame
 * alive, so the chosen one needs converting back before it can be shown or
 * exported. Copies into a `ctx.createImageData()`-allocated buffer (matching
 * debugSteps.ts's own ImageData-building convention) rather than the `new
 * ImageData(data, …)` constructor form, whose TS typings require the
 * array's buffer be a plain `ArrayBuffer` and reject the wider
 * `ArrayBufferLike` type this buffer's `Uint8ClampedArray` actually
 * carries. */
function rgbaBufferToCanvas(buffer: { data: Uint8ClampedArray; width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to render the selected burst frame.");
  }
  const imageData = ctx.createImageData(buffer.width, buffer.height);
  imageData.data.set(buffer.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
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
  if (cameraStatus === "starting") {
    return "Starting camera…";
  }
  if (cameraStatus === "active") {
    return "Stop Scan";
  }
  return "Start Scan";
}

function parseCardPrintFormat(value: string): CardPrintFormat {
  switch (value) {
    case "portrait":
    case "landscape":
      return value;
    default:
      throw new Error(`Unexpected card print format: ${value}`);
  }
}

/** The resolution `<select>`'s `<option value>` for a given size — used both
 * to populate the dropdown from CAMERA_RESOLUTION_OPTIONS and to look up
 * which option a change event's selected value corresponds to. */
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

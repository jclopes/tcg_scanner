/**
 * The Scan button / scan session's explicit state machine, per the task's
 * instruction to make states explicit rather than tracking scattered
 * booleans.
 *
 * - "idle": camera preview is live (if available), no detection loop
 *   running, no result shown. Starting state, and where "scan again"
 *   returns to.
 * - "scanning": the detection loop (src/shell/detectionLoop.ts) is running,
 *   guide overlay is visible.
 * - "processing": a frame was just accepted and the loop stopped, but the
 *   capture/flatten/rotate step (src/shell/capture.ts) hasn't finished yet.
 *   Split out from "scanning" as its own explicit state (rather than a
 *   sub-flag) since it's a meaningfully different moment for the UI: the
 *   guide overlay is gone, the detection loop isn't running, but there's no
 *   result yet either.
 * - "captured": the capture step finished and the result is displayed.
 * - "error": something in the camera/detection pipeline failed in a way the
 *   user needs to see (permission denied, no camera, capture failure,
 *   etc). `message` is a human-readable description.
 */
export type ScanPhase = "idle" | "scanning" | "processing" | "captured" | "error";

export interface ScanState {
  phase: ScanPhase;
  message?: string;
}

export const INITIAL_SCAN_STATE: ScanState = { phase: "idle" };

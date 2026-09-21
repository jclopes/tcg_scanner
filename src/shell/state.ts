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
 * - "processing": a quad was accepted and the shell is capturing a short
 *   burst of further frames to pick the sharpest, best-matched one from
 *   (src/shell/flattenedFrameBurst.ts) and flattening it into the final
 *   output — no overlay, no live detection loop running, but there's no
 *   result yet either. The user is expected to keep holding the card in
 *   place through this.
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

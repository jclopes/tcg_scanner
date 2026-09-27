/**
 * The scan session's state machine:
 * - "idle": no detection running, no result shown.
 * - "scanning": the detection loop is running and the guide is shown.
 * - "processing": a quad was accepted; capturing the burst, flattening the
 *   best frame and identifying the card. The user keeps holding the card.
 * - "captured": the result is displayed.
 * - "error": a failure the user needs to see; `message` describes it.
 *
 * For "scanning" and "captured", `message` optionally replaces the default
 * status text (e.g. why scanning restarted).
 */
export type ScanPhase = "idle" | "scanning" | "processing" | "captured" | "error";

export interface ScanState {
  phase: ScanPhase;
  message?: string;
}

export const INITIAL_SCAN_STATE: ScanState = { phase: "idle" };

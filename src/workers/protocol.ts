// Message protocol between the main thread (pool.ts) and each
// edge-detection worker (edgeDetectionWorker.ts).

import type { EdgeBandPixels, FittedLine, Point } from "../core";

/**
 * Sent from the main thread (pool.ts) to a worker.
 *
 * `id` lets the pool match an async response back to the request that
 * produced it (a worker processes one request at a time, but the id keeps
 * the protocol correct even if that ever changes). `band`'s `data.buffer`
 * is transferred (not structured-clone-copied) — see pool.ts.
 * `outwardDirection` is fitEdgeLine's outward-clustering parameter (see its
 * doc comment) — always the same value for a given worker slot (it never
 * handles a different side), but sent per-request rather than configured
 * once, to keep each request self-contained. `rotationToleranceDegrees` is
 * fitEdgeLine's angle-plausibility parameter (see its doc comment) — the
 * same `ToleranceConfig.rotationToleranceDegrees` used for the live scan
 * loop generally (see DEFAULT_TOLERANCE_CONFIG).
 */
export interface DetectEdgeRequest {
  type: "detect-edge";
  id: number;
  band: EdgeBandPixels;
  outwardDirection: Point;
  rotationToleranceDegrees: number;
}

/**
 * Sent from a worker back to the main thread once `fitEdgeLine` has run.
 *
 * `line` is `FittedLine | null` — `null` means "edge not found", the same
 * meaning `fitEdgeLine` itself gives a `null` return. The result's
 * `line.point`/`line.direction` remain in band-local coordinates, exactly as
 * `fitEdgeLine` produces them; the pool does not translate them.
 */
export interface DetectEdgeResponse {
  type: "detect-edge-result";
  id: number;
  line: FittedLine | null;
}

/**
 * Sent from a worker to the main thread exactly once, after the worker has
 * finished initializing OpenCV.js and is ready to accept `DetectEdgeRequest`
 * messages. The pool waits for this before sending requests.
 */
export interface WorkerReadyMessage {
  type: "ready";
}

/** Sent from a worker to the main thread if OpenCV.js fails to initialize. */
export interface WorkerInitErrorMessage {
  type: "init-error";
  message: string;
}

/** Sent from a worker to the main thread if handling request `id` throws. */
export interface WorkerErrorMessage {
  type: "error";
  id: number;
  message: string;
}

/** Messages a worker may send. */
export type WorkerResponse = DetectEdgeResponse | WorkerReadyMessage | WorkerInitErrorMessage | WorkerErrorMessage;

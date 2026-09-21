// The edge-detection worker pool: exactly 4 dedicated Web Workers, one per
// guide edge side (top/right/bottom/left), spawned once and reused across
// every frame. This is the only file a later stage (the imperative shell)
// needs to import from src/workers/ — see docs/plan/04-worker-pool.md for
// the full write-up of this API.
//
// Per the plan's "Parallel per-edge detection" bullet: 4 fixed workers,
// matching 4 edges, is the simplest option the plan lists ("one per edge, or
// a small worker pool"). A navigator.hardwareConcurrency-sized generic pool
// is explicitly left as a later refinement (plan's Open Questions #4) and is
// deliberately not built here.

import { outwardDirectionForSide } from "../core";
import type { EdgeBandPixels, FittedLine } from "../core";
import type { DetectEdgeRequest, WorkerResponse } from "./protocol";

const EDGE_SIDES = ["top", "right", "bottom", "left"] as const;

type PendingEntry = {
  resolve: (line: FittedLine | null) => void;
  reject: (error: Error) => void;
};

interface WorkerSlot {
  side: (typeof EDGE_SIDES)[number];
  worker: Worker;
  ready: Promise<void>;
  nextRequestId: number;
  pending: Map<number, PendingEntry>;
  /**
   * Set once this worker has crashed (`worker.onerror`), whether that
   * happens before or after `ready` resolved. `ready` is a promise and can
   * only ever settle once, so a post-ready crash has no way to "un-resolve"
   * it — this flag is what lets `sendDetectRequest` detect a post-ready
   * crash and reject immediately instead of posting to a dead worker and
   * hanging forever (see `sendDetectRequest`).
   */
  dead: boolean;
}

/** The 4 edge-band inputs for one frame, in [top, right, bottom, left] order
 * — the same order src/core's `expectedEdgeBands` returns its bands in. */
export type EdgeBandsInput = readonly [
  EdgeBandPixels,
  EdgeBandPixels,
  EdgeBandPixels,
  EdgeBandPixels,
];

/** The 4 fitted-line results, in the same [top, right, bottom, left] order
 * as the `EdgeBandsInput` that produced them. */
export type EdgeLineResults = [
  FittedLine | null,
  FittedLine | null,
  FittedLine | null,
  FittedLine | null,
];

export interface EdgeDetectionPool {
  /**
   * Resolves once all 4 workers have finished initializing OpenCV.js and
   * are ready to accept `detectEdges()` calls. Awaiting this up front is
   * optional — `detectEdges()` awaits it internally too — but a caller that
   * wants to show a "warming up" state before enabling Scan can await it
   * explicitly.
   */
  ready: Promise<void>;

  /**
   * Runs `fitEdgeLine` for all 4 edge bands in parallel — one dedicated
   * worker per side — and resolves once all 4 have responded.
   *
   * `bands` must be in `[top, right, bottom, left]` order (matching core's
   * `expectedEdgeBands` tuple order); the resolved tuple is in that same
   * order. Awaits pool readiness internally, so it's safe to call this
   * immediately after `createEdgeDetectionPool()` without awaiting `ready`
   * first (the call just queues behind worker startup).
   *
   * Each band's `data` (a `Uint8ClampedArray`) is *transferred*, not
   * structured-clone-copied, to its worker — the fast path this pool exists
   * for. That means each input band's underlying `ArrayBuffer` is detached
   * (neutered) by this call and must not be read or reused afterwards;
   * pass a freshly-allocated `EdgeBandPixels` per frame per band.
   *
   * `rotationToleranceDegrees` is forwarded to `fitEdgeLine` as its
   * angle-plausibility bound — pass `ToleranceConfig.rotationToleranceDegrees`
   * (see DEFAULT_TOLERANCE_CONFIG).
   */
  detectEdges(bands: EdgeBandsInput, rotationToleranceDegrees: number): Promise<EdgeLineResults>;

  /**
   * Terminates all 4 workers immediately. Any in-flight `detectEdges()`
   * calls reject. Call this when detection is no longer needed (e.g.
   * leaving the scan view) to free the 4 WASM instances. The pool instance
   * is unusable afterwards — call `createEdgeDetectionPool()` again if
   * detection is needed later.
   */
  terminate(): void;
}

function createWorkerSlot(side: (typeof EDGE_SIDES)[number]): WorkerSlot {
  const worker = new Worker(new URL("./edgeDetectionWorker.ts", import.meta.url), {
    type: "module",
  });

  const pending = new Map<number, PendingEntry>();

  // Mutable box for the "this worker has crashed" flag, shared between the
  // `ready` executor below (which sets it) and the WorkerSlot object
  // returned at the end (which exposes it to sendDetectRequest). A plain
  // object rather than a `let` so `worker.onerror` can mutate it via
  // closure without needing the not-yet-constructed `slot` in scope.
  const deadFlag = { dead: false };

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      switch (message.type) {
        case "ready": {
          resolveReady();
          // Readiness is a one-time event; subsequent messages are request
          // results, handled below.
          worker.onmessage = (resultEvent: MessageEvent<WorkerResponse>) => {
            handleResultMessage(resultEvent.data, pending);
          };
          break;
        }
        case "detect-edge-result":
        case "error": {
          // A response can only arrive here (before "ready" fired) if
          // initialization itself failed — handleResultMessage still
          // routes it correctly (init errors have no `id`, so this falls
          // into the "no matching pending entry" branch, which is fine:
          // there's nothing pending yet either way).
          handleResultMessage(message, pending);
          if (message.type === "error" && message.id === undefined) {
            rejectReady(new Error(`Edge detection worker (${side}) failed to initialize: ${message.message}`));
          }
          break;
        }
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      // Mark the slot dead unconditionally — this can fire either before
      // `ready` resolves (handled below via rejectReady, a no-op if it
      // already settled) or, just as importantly, *after* `ready` already
      // resolved (a worker that initialized fine and later died mid-session
      // processing a real frame). `ready`'s promise can only settle once,
      // so a post-ready crash has no way to surface through it — `dead` is
      // what lets sendDetectRequest notice and reject immediately instead
      // of posting to a dead worker and hanging forever.
      deadFlag.dead = true;
      const error = new Error(`Edge detection worker (${side}) crashed: ${event.message}`);
      rejectReady(error);
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
    };
  });

  return {
    side,
    worker,
    ready,
    nextRequestId: 0,
    pending,
    get dead() {
      return deadFlag.dead;
    },
  };
}

function handleResultMessage(message: WorkerResponse, pending: Map<number, PendingEntry>): void {
  if (message.type === "ready") {
    return;
  }
  if (message.id === undefined) {
    // Worker-init failure — nothing was pending yet; surfaced via the
    // slot's `ready` rejection instead (see createWorkerSlot).
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) {
    return;
  }
  pending.delete(message.id);
  if (message.type === "detect-edge-result") {
    entry.resolve(message.line);
  } else {
    entry.reject(new Error(message.message));
  }
}

function sendDetectRequest(
  slot: WorkerSlot,
  band: EdgeBandPixels,
  rotationToleranceDegrees: number,
): Promise<FittedLine | null> {
  if (slot.dead) {
    // The worker crashed after `ready` had already resolved (see
    // WorkerSlot.dead's doc comment) — posting to it would either throw or,
    // worse, silently go nowhere and leave this promise pending forever,
    // freezing the caller's detection loop. Reject immediately instead:
    // per the plan's "fail fast" emphasis, an explicit rejection the caller
    // can catch is far better than a hang with no way to detect or recover
    // from it.
    return Promise.reject(
      new Error(`Edge detection worker (${slot.side}) has crashed and was not restarted — recreate the pool.`),
    );
  }
  const id = slot.nextRequestId++;
  const request: DetectEdgeRequest = {
    type: "detect-edge",
    id,
    band,
    outwardDirection: outwardDirectionForSide(slot.side),
    rotationToleranceDegrees,
  };
  return new Promise<FittedLine | null>((resolve, reject) => {
    slot.pending.set(id, { resolve, reject });
    slot.worker.postMessage(request, [band.data.buffer]);
  });
}

/**
 * Creates the edge-detection worker pool: spawns the 4 dedicated workers
 * (one per edge side) immediately and starts their OpenCV.js initialization.
 * See `EdgeDetectionPool` for the returned object's API.
 */
export function createEdgeDetectionPool(): EdgeDetectionPool {
  const slots = EDGE_SIDES.map((side) => createWorkerSlot(side));

  const ready = Promise.all(slots.map((slot) => slot.ready)).then(() => undefined);

  async function detectEdges(bands: EdgeBandsInput, rotationToleranceDegrees: number): Promise<EdgeLineResults> {
    await ready;
    const [top, right, bottom, left] = bands;
    const [topSlot, rightSlot, bottomSlot, leftSlot] = slots as [
      WorkerSlot,
      WorkerSlot,
      WorkerSlot,
      WorkerSlot,
    ];
    const results = await Promise.all([
      sendDetectRequest(topSlot, top, rotationToleranceDegrees),
      sendDetectRequest(rightSlot, right, rotationToleranceDegrees),
      sendDetectRequest(bottomSlot, bottom, rotationToleranceDegrees),
      sendDetectRequest(leftSlot, left, rotationToleranceDegrees),
    ]);
    return results as EdgeLineResults;
  }

  function terminate(): void {
    for (const slot of slots) {
      slot.worker.terminate();
      const terminationError = new Error(`Edge detection pool terminated (worker: ${slot.side})`);
      for (const entry of slot.pending.values()) {
        entry.reject(terminationError);
      }
      slot.pending.clear();
    }
  }

  return { ready, detectEdges, terminate };
}

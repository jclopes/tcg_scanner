// The edge-detection worker pool: exactly 4 dedicated Web Workers, one per
// guide edge side (top/right/bottom/left), spawned once and reused across
// every frame. See docs/plan/04-worker-pool.md.

import { mapEdges, outwardDirectionForSide } from "../core";
import type { EdgeBandPixels, FittedLine, PerEdge } from "../core";
import type { DetectEdgeRequest, WorkerResponse } from "./protocol";

const EDGE_SIDES = ["top", "right", "bottom", "left"] as const;
type EdgeSide = (typeof EDGE_SIDES)[number];

interface PendingEntry {
  resolve: (line: FittedLine | null) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  side: EdgeSide;
  worker: Worker;
  /** Resolves on the worker's "ready" message; rejects if it fails to
   * initialize or crashes first. */
  ready: Promise<void>;
  nextRequestId: number;
  pending: Map<number, PendingEntry>;
  /** Set when the worker crashes. `ready` can only settle once, so this is
   * what lets a post-ready crash reject new requests instead of hanging. */
  dead: boolean;
}

export interface EdgeDetectionPool {
  /**
   * Runs `fitEdgeLine` for all 4 bands in parallel, one worker per side,
   * waiting for the workers to finish initializing first.
   *
   * Each band's `data` buffer is *transferred* to its worker, so it's
   * detached after this call and must not be reused.
   */
  detectEdges(bands: PerEdge<EdgeBandPixels>, rotationToleranceDegrees: number): Promise<PerEdge<FittedLine | null>>;

  /** Terminates all 4 workers; in-flight `detectEdges()` calls reject. The
   * pool is unusable afterwards. */
  terminate(): void;
}

/** Spawns the 4 workers immediately and starts their OpenCV.js
 * initialization. */
export function createEdgeDetectionPool(): EdgeDetectionPool {
  const slots = mapEdges(EDGE_SIDES, createWorkerSlot);
  const ready = Promise.all(mapEdges(slots, (slot) => slot.ready));

  return {
    async detectEdges(bands, rotationToleranceDegrees) {
      await ready;
      return Promise.all(mapEdges(slots, (slot, i) => sendDetectRequest(slot, bands[i]!, rotationToleranceDegrees)));
    },
    terminate() {
      for (const slot of slots) {
        slot.worker.terminate();
        rejectAllPending(slot, new Error(`Edge detection pool terminated (worker: ${slot.side})`));
      }
    },
  };
}

/** Creates the pool on first use and keeps it (starting it loads OpenCV.js in
 * each worker) until `terminate()`; the next `get()` creates a new one. */
export class LazyEdgeDetectionPool {
  private pool: EdgeDetectionPool | null = null;

  get(): EdgeDetectionPool {
    this.pool ??= createEdgeDetectionPool();
    return this.pool;
  }

  terminate(): void {
    this.pool?.terminate();
    this.pool = null;
  }
}

function createWorkerSlot(side: EdgeSide): WorkerSlot {
  const worker = new Worker(new URL("./edgeDetectionWorker.ts", import.meta.url), { type: "module" });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const slot: WorkerSlot = {
    side,
    worker,
    ready: new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    }),
    nextRequestId: 0,
    pending: new Map(),
    dead: false,
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      resolveReady();
      return;
    }
    if (message.type === "init-error") {
      rejectReady(new Error(`Edge detection worker (${side}) failed to initialize: ${message.message}`));
      return;
    }
    const entry = slot.pending.get(message.id);
    if (!entry) {
      throw new Error(`Edge detection worker (${side}) answered unknown request ${message.id}.`);
    }
    slot.pending.delete(message.id);
    if (message.type === "detect-edge-result") {
      entry.resolve(message.line);
    } else {
      entry.reject(new Error(message.message));
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    slot.dead = true;
    const error = new Error(`Edge detection worker (${side}) crashed: ${event.message}`);
    rejectReady(error);
    rejectAllPending(slot, error);
  };

  return slot;
}

function sendDetectRequest(slot: WorkerSlot, band: EdgeBandPixels, rotationToleranceDegrees: number): Promise<FittedLine | null> {
  if (slot.dead) {
    return Promise.reject(new Error(`Edge detection worker (${slot.side}) has crashed — recreate the pool.`));
  }
  const request: DetectEdgeRequest = {
    type: "detect-edge",
    id: slot.nextRequestId++,
    band,
    outwardDirection: outwardDirectionForSide(slot.side),
    rotationToleranceDegrees,
  };
  return new Promise((resolve, reject) => {
    slot.pending.set(request.id, { resolve, reject });
    slot.worker.postMessage(request, [band.data.buffer]);
  });
}

function rejectAllPending(slot: WorkerSlot, error: Error): void {
  for (const entry of slot.pending.values()) {
    entry.reject(error);
  }
  slot.pending.clear();
}

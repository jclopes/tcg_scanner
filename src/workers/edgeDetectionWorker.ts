/// <reference lib="webworker" />

// Runs inside a dedicated Web Worker's own global scope. pool.ts spawns
// exactly 4 instances of this script, one per edge side (top/right/bottom/
// left), each with its own isolated OpenCV.js/WASM instance. This file owns
// exactly two responsibilities: (1) initialize OpenCV.js once when the
// worker starts, and (2) on each DetectEdgeRequest, call the functional
// core's fitEdgeLine and post back the result. All actual detection logic
// lives in src/core/edgeLine.ts — this stays a thin message-handling
// wrapper, per 02-project-structure.md's note for src/workers/. Do not add
// detection logic here.
//
// Needs the `/// <reference lib="webworker" />` directive above because the
// project's tsconfig.json sets a DOM-only `lib` (see
// 02-project-structure.md's note about this) — this per-file directive adds
// the WebWorker global typings (`self` as DedicatedWorkerGlobalScope,
// `postMessage`, `onmessage`, etc.) for this file only, without touching the
// shared tsconfig.

import { fitEdgeLine } from "../core";
import type { OpenCv } from "../core";
import { loadOpenCv } from "../loadOpenCv";
import type { DetectEdgeRequest, WorkerResponse } from "./protocol";

// At runtime (spawned via `new Worker(url, { type: "module" })`) `self` is a
// DedicatedWorkerGlobalScope. The webworker lib reference above makes that
// type available; this cast is needed because the project's ambient `self`
// (from the shared DOM lib) is still `Window & typeof globalThis`.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// pool.ts spawns 4 instances of this script — each one still calls
// loadOpenCv() independently and gets its own isolated WASM instance (see
// docs/plan/04-worker-pool.md for why that's the accepted tradeoff; the
// plan's explicit priority is fast/reliable detection, not minimizing
// memory). What loadOpenCv() changes is *where the JS comes from*: all 4 of
// these, the super-res worker, and the main thread now load the same
// /opencv.js URL, so only the first of those 6 contexts actually triggers a
// network fetch — the rest are served from the browser's own HTTP cache.

// Set once OpenCV.js finishes initializing; undefined until then. A request
// that somehow arrives before that (shouldn't happen — the pool queues
// requests behind its readiness promise) is answered with an error rather
// than throwing.
let cvInstance: OpenCv | undefined;

function postResponse(message: WorkerResponse): void {
  ctx.postMessage(message);
}

function handleRequest(request: DetectEdgeRequest): void {
  if (!cvInstance) {
    postResponse({
      type: "error",
      id: request.id,
      message: "Worker received a detect-edge request before OpenCV.js finished initializing.",
    });
    return;
  }
  try {
    const line = fitEdgeLine(cvInstance, request.band, request.outwardDirection, request.rotationToleranceDegrees);
    postResponse({ type: "detect-edge-result", id: request.id, line });
  } catch (error) {
    postResponse({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

ctx.onmessage = (event: MessageEvent<DetectEdgeRequest>) => {
  handleRequest(event.data);
};

loadOpenCv()
  .then((cv) => {
    cvInstance = cv;
    postResponse({ type: "ready" });
  })
  .catch((error: unknown) => {
    postResponse({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

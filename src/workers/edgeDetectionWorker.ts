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

// Each of the 4 instances loads its own OpenCV.js WASM instance (see
// docs/plan/04-worker-pool.md); the script itself comes from the browser's
// HTTP cache after the first fetch (see loadOpenCv).

// Set once OpenCV.js finishes initializing. The pool only sends requests
// after "ready", so a request before then is a bug.
let cvInstance: OpenCv | undefined;

function postResponse(message: WorkerResponse): void {
  ctx.postMessage(message);
}

function handleRequest(request: DetectEdgeRequest): void {
  if (!cvInstance) {
    throw new Error("Worker received a detect-edge request before OpenCV.js finished initializing.");
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
      type: "init-error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

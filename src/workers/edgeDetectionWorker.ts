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

import cvModule from "@techstark/opencv-js";
import { fitEdgeLine } from "../core";
import type { OpenCv } from "../core";
import type { DetectEdgeRequest, WorkerResponse } from "./protocol";

// At runtime (spawned via `new Worker(url, { type: "module" })`) `self` is a
// DedicatedWorkerGlobalScope. The webworker lib reference above makes that
// type available; this cast is needed because the project's ambient `self`
// (from the shared DOM lib) is still `Window & typeof globalThis`.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Same init dance as src/main.ts's waitForOpenCv, duplicated here rather
 * than imported: src/main.ts isn't a shared module, and each worker
 * deliberately gets its own isolated OpenCV.js/WASM instance rather than
 * sharing one — see docs/plan/04-worker-pool.md for why that's the accepted
 * tradeoff (the plan's explicit priority is fast/reliable detection; binary
 * size duplication across 4 workers doesn't matter).
 */
async function waitForOpenCv(): Promise<OpenCv> {
  if (cvModule instanceof Promise) {
    return (await cvModule) as OpenCv;
  }
  const mod = cvModule as OpenCv & { onRuntimeInitialized?: () => void; Mat?: unknown };
  if (mod.Mat) {
    return mod;
  }
  await new Promise<void>((resolve) => {
    mod.onRuntimeInitialized = () => resolve();
  });
  return mod;
}

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
    const line = fitEdgeLine(cvInstance, request.band);
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

waitForOpenCv()
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

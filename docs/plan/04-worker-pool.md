# Phase 1 — Edge Detection Worker Pool: API Reference

This document is the authoritative, as-built reference for `src/workers/`
— the "Parallel per-edge detection" piece of
[01-capture-and-detection.md](./01-capture-and-detection.md)'s "Detection
strategy" section. It's aimed at whichever stage builds the imperative shell
(camera/UI code, not yet built as of this writing) — that's the only
intended caller of this module.

Everything a caller needs is exported from `src/workers/index.ts`:

```ts
import { createEdgeDetectionPool } from "../workers";
// or a relative path from wherever the shell's frame loop lives
```

`protocol.ts` (the message shapes) and `edgeDetectionWorker.ts` (the worker
script) are internal — the shell should never need to import them directly
or know that `postMessage` is involved at all.

## Why this exists

Per the plan's "Parallel per-edge detection" bullet: the 4 guide edge bands
are independent, so each frame's 4 calls to `fitEdgeLine` (from
`src/core/edgeLine.ts`) run in parallel across 4 Web Workers rather than
sequentially on the main thread, so the live-preview loop isn't blocked by
4x the per-frame detection cost.

## Public API

### `createEdgeDetectionPool(): EdgeDetectionPool`

Spawns 4 dedicated Web Workers immediately (one per edge side: top, right,
bottom, left) and kicks off each one's OpenCV.js initialization. Call this
once (e.g. when the scan view mounts), not per frame.

```ts
interface EdgeDetectionPool {
  ready: Promise<void>;
  detectEdges(bands: EdgeBandsInput): Promise<EdgeLineResults>;
  terminate(): void;
}

type EdgeBandsInput = readonly [
  EdgeBandPixels,
  EdgeBandPixels,
  EdgeBandPixels,
  EdgeBandPixels,
];

type EdgeLineResults = [
  FittedLine | null,
  FittedLine | null,
  FittedLine | null,
  FittedLine | null,
];
```

`EdgeBandPixels` and `FittedLine` are `src/core`'s own types (re-exported
here only for this doc's sake) — this module never defines its own
band/line shapes, it just moves `src/core`'s existing ones across a
`postMessage` boundary.

#### `ready: Promise<void>`

Resolves once all 4 workers have finished initializing their own OpenCV.js
/ WASM instance. Optional to await explicitly — `detectEdges()` awaits it
internally — but useful if the shell wants to show a "warming up" state
before enabling the Scan button, so the *first* frame doesn't pay worker
startup latency.

Rejects if any worker fails to initialize (see Error handling below).

#### `detectEdges(bands: EdgeBandsInput): Promise<EdgeLineResults>`

The pool's one per-frame entry point. Call it once per evaluated frame.

- **Input order:** `bands` must be `[top, right, bottom, left]` — the exact
  tuple order `src/core`'s `expectedEdgeBands` already returns. The
  intended calling pattern is: run `expectedEdgeBands`, sample each band's
  region into an `EdgeBandPixels` (grayscale, per `EdgeBandPixels`'s own
  contract in `src/core/types.ts`), and pass the resulting 4-tuple straight
  into `detectEdges`.
- **Output order:** the resolved `EdgeLineResults` tuple is in the same
  `[top, right, bottom, left]` order — `results[0]` is top's `FittedLine |
  null`, etc. Each dedicated worker always handles the same side every
  frame (worker 0 = top, worker 1 = right, worker 2 = bottom, worker 3 =
  left) — sides are never reassigned across frames.
- **`null` entries:** exactly what `fitEdgeLine` itself returns for a
  not-found/low-confidence edge — this pool is a transparent pass-through,
  it doesn't add its own notion of failure for a normal "edge not found"
  result. The caller (`evaluateFrameForQuad`) rejects the frame as
  `edge-not-found` as soon as any of the 4 results is `null`.
- **Coordinates:** each `FittedLine`'s `point`/`direction` are in
  band-local pixel coordinates, exactly as `fitEdgeLine` produces them —
  this pool does no coordinate translation. The caller still owns adding
  each band's `region.origin` before calling `intersectLines` across two
  different bands' results.
- **Safe to call before `ready` resolves** — internally awaits pool
  readiness first, so `detectEdges` just queues behind worker startup on
  the first call(s) rather than racing it.

**Transferable objects (read before wiring this up):** each band's `data`
(`Uint8ClampedArray`) is passed to its worker via `postMessage`'s transfer
list (`[band.data.buffer]`), not structured-clone-copied — this is the
whole point of parallelizing (copying 4 pixel buffers every frame across a
worker boundary would eat much of the win). The consequence: **each input
band's underlying `ArrayBuffer` is detached the moment `detectEdges` is
called** — it becomes unusable (zero-length) in the caller after that.
**The caller must pass a freshly-allocated `EdgeBandPixels` for every band,
every frame** — never reuse or read from a buffer that was already passed
to a previous `detectEdges` call. This is the pool's one binding
requirement.

#### `terminate(): void`

Terminates all 4 workers immediately and rejects any of that call's
in-flight `detectEdges()` promises. Call when detection is no longer
needed (leaving the scan view) to free the 4 WASM instances. The pool
instance is unusable after this — call `createEdgeDetectionPool()` again if
detection is needed later. There's no `restart()`/reuse path by design —
this stays a one-shot lifecycle object, matching "spawned once and reused
across every frame, not respawned per frame" from the task brief; the
*pool* isn't respawned per frame either, only created/torn down around the
scan session as a whole.

### Error handling

- **Worker init failure** (OpenCV.js failed to load/initialize inside a
  worker): that worker posts an `error` message with no `id`; the pool
  rejects its combined `ready` promise (and therefore also any
  `detectEdges()` call awaiting it) with an `Error` naming which edge side's
  worker failed and why.
- **Per-request failure** (an exception thrown while handling one
  `detect-edge` message — e.g. malformed band dimensions slipping past
  `fitEdgeLine`'s own guard): that worker posts an `error` message carrying
  the request's `id`; only that side's `Promise` in the `Promise.all` inside
  `detectEdges` rejects (which rejects the whole `detectEdges()` call, since
  it's a `Promise.all` over all 4 sides — a single bad band fails the whole
  frame, which is correct: a frame needs all 4 edges to validate a quad
  anyway).
- **Worker crash** (uncaught exception / the worker thread dying, distinct
  from a normal `error` protocol message): the pool's `worker.onerror`
  handler marks that slot **dead** (an internal flag, independent of
  `ready`), rejects that slot's `ready` if it hadn't resolved yet, and
  rejects any of that slot's currently-pending `detectEdges` sub-promises.
  This covers both timings a crash can happen at:
  - **Before `ready` resolved** (crash during OpenCV.js init): the pool's
    combined `ready` promise rejects, so both an explicit `await pool.ready`
    and any `detectEdges()` call (which awaits `ready` internally) reject
    with a descriptive error.
  - **After `ready` already resolved** (a worker that initialized fine and
    later dies mid-session — plausible for a WASM pipeline processing
    varied real camera frames): `ready` is a promise and can only settle
    once, so it can't "un-resolve" to surface this. Instead, every
    subsequent `detectEdges()` call checks the dead flag before posting to
    that worker and **rejects immediately** with `Error("Edge detection
    worker (<side>) has crashed and was not restarted — recreate the
    pool.")`, rather than posting to a dead worker and leaving that call's
    promise pending forever. A hang here would freeze the live scan loop
    with no way for the shell to detect or recover from it, which
    contradicts the plan's "fail fast" emphasis — so this is treated as a
    correctness requirement, not a nice-to-have.

  There is **no automatic restart** of a crashed worker in either case —
  out of scope for this stage (see Judgment calls below); a caller that
  wants resilience against a mid-session worker crash needs to catch the
  rejection, call `terminate()`, and create a new pool.

## Message protocol (`src/workers/protocol.ts`)

Internal to this module, documented here for completeness / for anyone
debugging across the `postMessage` boundary.

```ts
// main thread -> worker
interface DetectEdgeRequest {
  type: "detect-edge";
  id: number;          // matches the eventual response back to this request
  band: EdgeBandPixels; // band.data's ArrayBuffer is transferred, not copied
}

// worker -> main thread
interface DetectEdgeResponse {
  type: "detect-edge-result";
  id: number;
  line: FittedLine | null; // exactly fitEdgeLine's return value
}

interface WorkerReadyMessage {
  type: "ready"; // sent once, after OpenCV.js finishes initializing
}

interface WorkerErrorMessage {
  type: "error";
  id?: number;    // absent = init failure; present = that request failed
  message: string;
}

type WorkerRequest = DetectEdgeRequest;
type WorkerResponse = DetectEdgeResponse | WorkerReadyMessage | WorkerErrorMessage;
```

## Internal structure (for maintainers, not callers)

- `edgeDetectionWorker.ts` — the script each of the 4 workers runs
  (`new Worker(new URL("./edgeDetectionWorker.ts", import.meta.url), { type:
  "module" })`, per Vite's native module-worker syntax). On load: awaits
  OpenCV.js init (same promise/`onRuntimeInitialized` dance as
  `src/main.ts`'s `waitForOpenCv`, duplicated locally — see Judgment calls),
  posts `{ type: "ready" }`, then handles each `DetectEdgeRequest` by
  calling `src/core`'s `fitEdgeLine(cv, request.band)` and posting the
  result back. Needs `/// <reference lib="webworker" />` at the top since
  the project's `tsconfig.json` `lib` is DOM-only (see
  [02-project-structure.md](./02-project-structure.md)); this compiled
  cleanly alongside the rest of the DOM-lib project (`npx tsc --noEmit`,
  confirmed) — no separate tsconfig was needed.
- `pool.ts` — `createEdgeDetectionPool`. Spawns the 4 workers via
  `createWorkerSlot` (one per `EDGE_SIDES` entry, fixed
  `["top", "right", "bottom", "left"]` order), tracks each slot's
  `ready` promise, a `dead` flag, and a `Map<requestId, {resolve, reject}>`
  of in-flight requests, and wires `worker.onmessage`/`worker.onerror` to
  resolve/reject the right promise. `worker.onerror` sets `dead` regardless
  of whether `ready` had already resolved (see "Worker crash" above);
  `sendDetectRequest` checks `dead` before every `postMessage` and rejects
  immediately instead of posting to a dead worker. `detectEdges` fans out
  one `sendDetectRequest` per slot and `Promise.all`s the 4 results back
  into the documented tuple.
- `index.ts` — the barrel; exports only `createEdgeDetectionPool` and the
  `EdgeDetectionPool`/`EdgeBandsInput`/`EdgeLineResults` types.

## Judgment calls

- **Exactly 4 fixed, dedicated workers (one per edge side), spawned once
  and reused across every frame** — the simplest option the plan
  explicitly lists ("one per edge, or a small worker pool reused across
  frames"), per the task brief. A `navigator.hardwareConcurrency`-sized
  generic pool is the plan's own Open Question #4 and is explicitly left
  for a later stage — not built here.
- **Each worker gets its own isolated OpenCV.js/WASM instance** rather than
  sharing one across workers (which isn't possible with a plain `<script>`-
  loaded/ESM-imported WASM module anyway, without extra plumbing like
  `SharedArrayBuffer`/cross-origin-isolation setup). This matches the task
  brief's framing directly ("that's expected and fine... size doesn't
  matter") and the plan's own stated priority ("Most important is to have a
  fast reliable edge detection").
- **No buffers transferred back on response.** Only the small
  `DetectEdgeResponse`/`WorkerErrorMessage` (a few numbers/strings) is
  posted back from a worker — there's no reason to transfer the original
  pixel buffer back since the response never carries pixel data. This
  means the caller must allocate a fresh `EdgeBandPixels` every frame
  (documented above under `detectEdges`) rather than round-tripping and
  reusing one buffer — the simpler contract, and consistent with the shell
  needing to re-sample a live video frame each time anyway (there's no
  stable buffer to reuse frame-to-frame regardless).
- **No automatic worker restart on crash.** A crashed worker's slot stays
  dead for the rest of that pool's lifetime; recovering requires
  `terminate()` + a new `createEdgeDetectionPool()`. Simplest explicit
  behavior for an edge case the plan doesn't mention; revisit if real
  devices show workers crashing in practice.
- **`detectEdges` takes/returns a fixed 4-tuple, not a `Map`/object keyed by
  side.** Matches `src/core`'s own `expectedEdgeBands` tuple-order
  convention exactly, so the shell can pass its result straight through
  without re-keying. Simpler than inventing a side-keyed shape the rest of
  `src/core` doesn't use.
- **`waitForOpenCv` is duplicated** (in `edgeDetectionWorker.ts`, mirroring
  `src/main.ts`'s helper of the same name/shape) rather than shared,
  because `src/main.ts` isn't a module — it's an entry point with no
  exports — and this task was scoped to not touch it. Both copies are
  small (a dozen lines) and unlikely to drift; not worth inventing a shared
  location for one duplicated helper.

## Verification

- `npm run build` (`tsc --noEmit && vite build`) passes — the worker files
  type-check cleanly against the project's DOM-lib `tsconfig.json` despite
  the per-file `webworker` lib reference; no lib conflicts were seen.
  `src/workers` isn't imported by `src/main.ts` yet (this stage
  deliberately doesn't wire it into the UI — that's the next stage's job),
  so it isn't part of the production `dist/` bundle yet; that's expected.
- `npm test` (Vitest) passes — unaffected, since no tests were added for
  this module. Per the task's explicit instruction, `src/workers` is
  glue/orchestration (message-passing, lifecycle management), not business
  logic, so it's deliberately not unit-tested — Vitest also can't
  realistically exercise real browser Web Workers.

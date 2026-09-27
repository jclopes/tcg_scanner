// Public API of src/workers. See docs/plan/04-worker-pool.md for the full
// write-up. Only the pool orchestrator is exported — the message protocol
// (protocol.ts) and the worker script itself (edgeDetectionWorker.ts) are
// internal to this module; a caller should never need to know about
// postMessage, worker lifecycles, or message shapes.

export type { EdgeDetectionPool } from "./pool";
export { createEdgeDetectionPool } from "./pool";

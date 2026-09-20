// Test-only helper. Not exported from src/core's public API (index.ts) and
// not imported by any production code — src/core's actual functions never
// import OpenCV.js themselves (see the OpenCv dependency-injection
// convention documented in ../types.ts). This just gives test files a single
// place to initialize the real OpenCV.js instance once and share it, instead
// of every test file duplicating the async init dance.

import { createRequire } from "node:module";
import type { OpenCv } from "../types";

// Judgment call: loaded via Node's createRequire rather than a normal
// `import cvModule from "@techstark/opencv-js"`. The normal static import
// works fine for src/main.ts under Vite's browser dev-server/build pipeline
// (confirmed in docs/plan/02-project-structure.md), but crashes here under
// Vitest's Node-side SSR module transform specifically: the package's CJS
// export is itself a thenable (its default export can literally be a
// Promise — see the branching below), and Vite/Vitest's ESM-interop wrapper
// for that shape trips over it (`TypeError: Method Promise.prototype.then
// called on incompatible receiver [object Module]`, thrown from the import
// statement itself, confirmed via an isolated repro before landing on this
// workaround). Requiring the CommonJS module directly through Node sidesteps
// that interop path entirely and is only used here, in test-only code that
// always runs under Node/Vitest.
const require = createRequire(import.meta.url);

let cvPromise: Promise<OpenCv> | undefined;

/** Resolves to the initialized OpenCV.js instance, memoized across calls
 * within a test run (OpenCV.js's WASM init is relatively slow, so tests
 * should call this once in a `beforeAll` and reuse the result). Mirrors the
 * init dance in src/main.ts (the package's export is sometimes a Promise,
 * sometimes an already-initialized module, sometimes a module that still
 * needs `onRuntimeInitialized` to fire — depends on timing). */
export function loadOpenCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cvModule: unknown = require("@techstark/opencv-js");
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
    })();
  }
  return cvPromise;
}

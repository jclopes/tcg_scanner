// Test-only: the real OpenCV.js, initialized once and shared across tests.
// Loaded with Node's `require` because Vitest's ESM interop fails on the
// package's thenable CommonJS export when it's `import`ed.

import { createRequire } from "node:module";
import type { OpenCv } from "../types";

const require = createRequire(import.meta.url);

let cvPromise: Promise<OpenCv> | undefined;

/** The initialized OpenCV.js instance (its WASM init is slow, so call this
 * once in a `beforeAll`). The package exports either a Promise of the module,
 * the ready module, or a module still waiting for `onRuntimeInitialized`. */
export function loadOpenCv(): Promise<OpenCv> {
  cvPromise ??= (async () => {
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
  return cvPromise;
}

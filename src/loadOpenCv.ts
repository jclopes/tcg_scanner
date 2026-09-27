import type { OpenCv } from "./core";

// No `declare global` here for `cv` — @techstark/opencv-js's own ambient
// types (dist/src/types/_cv.d.ts) already declare `var cv: CV & { FS: FS }`
// globally; redeclaring it here (even just to add `| undefined`, true until
// the script below actually runs) conflicts, since TS requires every
// declaration of the same global `var` to agree exactly.

const OPENCV_JS_URL = "/opencv.js";

/**
 * Loads OpenCV.js from a single, fixed URL (`/opencv.js`, a static copy of
 * `@techstark/opencv-js`'s own `dist/opencv.js` — see vite.config.ts's
 * `copyOpenCvToPublic` plugin) and resolves once its WASM runtime has
 * finished initializing.
 *
 * Not `import cvModule from "@techstark/opencv-js"`: Vite can't share a
 * chunk between a worker's build and the main build, so the main thread and
 * the edge-detection workers would each inline their own ~13MB copy. One
 * fixed static URL is fetched once and served from the HTTP cache after.
 *
 * Not `import(OPENCV_JS_URL)` either: Vite's dev server refuses to serve a
 * `public/` file through `import()`. The file is a plain UMD script, so
 * `fetch()` + `new Function(...)` runs it as the global script it expects;
 * its wrapper assigns the module to `globalThis.cv`, read below.
 */
export async function loadOpenCv(): Promise<OpenCv> {
  if (!globalThis.cv) {
    const response = await fetch(OPENCV_JS_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${OPENCV_JS_URL}: ${response.status} ${response.statusText}`);
    }
    const scriptText = await response.text();
    // Runs `scriptText` as an ordinary (non-module) global script — see
    // this function's doc comment for why that's what's needed here.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing a same-origin, build-controlled asset, not arbitrary/remote input.
    new Function(scriptText)();
  }
  const cvOrPromise = globalThis.cv as OpenCv | Promise<OpenCv> | undefined;
  if (!cvOrPromise) {
    throw new Error("Loaded /opencv.js, but it did not set the expected global `cv`.");
  }
  // The UMD wrapper assigns the Emscripten factory's return value, which is
  // either the ready module or a Promise of one. Setting
  // onRuntimeInitialized on the Promise would never fire, so check first.
  if (cvOrPromise instanceof Promise) {
    return cvOrPromise;
  }

  if ((cvOrPromise as OpenCv & { Mat?: unknown }).Mat) {
    return cvOrPromise;
  }
  await new Promise<void>((resolve) => {
    (cvOrPromise as OpenCv & { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => resolve();
  });
  return cvOrPromise;
}

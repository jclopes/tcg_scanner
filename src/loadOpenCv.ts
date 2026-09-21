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
 * Deliberately *not* `import cvModule from "@techstark/opencv-js"` — that's
 * what all 3 of this app's separate JS execution contexts (the main
 * thread, plus the edge-detection and super-resolution Web Workers, each a
 * `type: "module"` worker) used to do, and Vite/Rolldown has no way to
 * share a chunk between a worker's isolated build and the main build — so
 * each of the 3 got its own fully-inlined ~13MB copy of the library at
 * build time. A production visit downloaded the same library 3 times over,
 * with no way for the browser to recognize the 3 copies as "the same
 * thing" (3 different files, 3 different content hashes). Loading it
 * instead as an ordinary static asset from one fixed URL means the browser
 * fetches and caches it exactly once — every context after the first gets
 * it from cache.
 *
 * Also deliberately *not* `import(OPENCV_JS_URL)` — tried first, but Vite's
 * dev server explicitly refuses to serve a `public/` file through a JS
 * `import()`: public assets are only ever meant to be referenced via a
 * plain URL (an HTML tag, or here, `fetch`), never pulled into the module
 * graph, and it throws rather than silently doing something unexpected.
 * `fetch()` + executing the response text sidesteps module resolution
 * entirely — it's just an HTTP request, so it still goes through the
 * browser's normal cache exactly like any other asset — and actually suits
 * this file better anyway: it's a plain UMD script with no ES `export`s
 * (`new Function(...)`, not `import()`, is what makes it run as an
 * ordinary global script, the environment its own UMD wrapper expects).
 * That wrapper detects `importScripts`/`window` either way and assigns the
 * result to `globalThis.cv`, which is what's actually read below.
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
  // The UMD wrapper's factory() calls the Emscripten module function and
  // assigns *its return value* to globalThis.cv — which, depending on how
  // much of that async function ran synchronously before its first await,
  // is either the already-ready module or a Promise of one. Both are
  // `typeof "object"`, so this has to be checked explicitly rather than
  // assumed away; skipping it means the `onRuntimeInitialized` branch below
  // would set that property on a Promise instance instead of the real
  // module object, which does nothing — confirmed empirically (an earlier
  // version of this function, missing this check, hung forever waiting on
  // a callback that was never actually going to fire).
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

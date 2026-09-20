// Minimal local ambient typing for Node's `node:module#createRequire`, used
// only by testSupport/openCv.ts (see its doc comment for why it needs
// `require` at all). Deliberately not pulled in via an `@types/node`
// devDependency: adding that package makes Node's ambient globals
// (`process`, `Buffer`, `require`, ...) visible project-wide, which would
// weaken this project's "browser-only, no Node APIs" boundary for
// src/main.ts and future src/shell and src/workers code — too broad a
// tooling change for what this one test-only helper needs. This file is
// scoped to exactly the one function actually used.
declare module "node:module" {
  export function createRequire(url: string): (id: string) => unknown;
}

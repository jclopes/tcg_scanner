// Typing for the one Node API the tests use (testSupport/openCv.ts), instead
// of @types/node, which would make Node globals visible to browser code too.
declare module "node:module" {
  export function createRequire(url: string): (id: string) => unknown;
}

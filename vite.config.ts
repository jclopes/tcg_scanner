import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No test files exist yet — src/core is empty until a later stage adds
    // the functional-core unit tests described in the plan. Without this,
    // `vitest run` exits non-zero on an empty suite.
    passWithNoTests: true,
  },
});

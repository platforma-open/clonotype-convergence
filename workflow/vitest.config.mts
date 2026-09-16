import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    // Each tplTest renders against the local backend; the per-sample chain runs
    // a real compute-neighbours container, so the default 5s is far too tight.
    testTimeout: 120000,
    hookTimeout: 120000,
    maxConcurrency: 1,
  },
});

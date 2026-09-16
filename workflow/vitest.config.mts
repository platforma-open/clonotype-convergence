import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    // The FIRST test to run pays for the software package's python runenv being
    // built — the backend pip-installs pandas/numpy/scipy/scikit-learn/atriegc
    // into a container before compute-neighbours can run. That is minutes on a
    // cold CI runner and seconds locally once the image is cached, so the
    // timeout has to cover the build, not the test: the same case takes ~7s
    // once warm, and the two that follow reuse the image.
    testTimeout: 600000,
    hookTimeout: 600000,
    // One at a time: concurrent renders would each wait on the same image build.
    maxConcurrency: 1,
  },
});

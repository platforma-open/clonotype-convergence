import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import HeavyChainPage from "./pages/HeavyChainPage.vue";
import LightChainPage from "./pages/LightChainPage.vue";
import MainPage from "./pages/MainPage.vue";
import PerSamplePage from "./pages/PerSamplePage.vue";
import ScoreHeavyPage from "./pages/ScoreHeavyPage.vue";
import ScoreLightPage from "./pages/ScoreLightPage.vue";

export const sdkPlugin = defineAppV3(platforma, () => {
  return {
    routes: {
      // "/" → the aggregated, clonotype-only table (A-0015) — the shape
      // downstream consumes, shown first. Anchored on the populated chain.
      "/": () => MainPage,
      // Per-sample QC table (v1's internal per-sample family, sample sheet).
      "/per-sample": () => PerSamplePage,
      // Per-chain aggregated convergence-score histograms (starScore by starHit).
      "/convergence/score-heavy": () => ScoreHeavyPage,
      "/convergence/score-light": () => ScoreLightPage,
      // Per-chain per-sample neighbour-frequency (QC) histograms. Each shown
      // only when its chain is processed.
      "/convergence/heavy": () => HeavyChainPage,
      "/convergence/light": () => LightChainPage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

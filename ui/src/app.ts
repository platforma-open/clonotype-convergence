import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import AggregatedPage from "./pages/AggregatedPage.vue";
import HeavyChainPage from "./pages/HeavyChainPage.vue";
import LightChainPage from "./pages/LightChainPage.vue";
import MainPage from "./pages/MainPage.vue";

export const sdkPlugin = defineAppV3(platforma, () => {
  return {
    routes: {
      // "/" → main clonotype table. Anchored on the dataset pick (heavy
      // when populated, else light) — in SC paired mode both chains'
      // convergence columns join via the shared scClonotypeKey axis.
      "/": () => MainPage,
      // Clonotype-only aggregated export table (the downstream-consumable
      // signal, A-0011).
      "/export": () => AggregatedPage,
      // Per-chain frequency-distribution histograms. Each shown only
      // when its chain is processed.
      "/convergence/heavy": () => HeavyChainPage,
      "/convergence/light": () => LightChainPage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

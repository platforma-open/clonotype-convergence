import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import HeavyChainPage from "./pages/HeavyChainPage.vue";
import LightChainPage from "./pages/LightChainPage.vue";
import LightTablePage from "./pages/LightTablePage.vue";
import MainPage from "./pages/MainPage.vue";

export const sdkPlugin = defineAppV3(platforma, () => {
  return {
    routes: {
      // "/" → heavy clonotype table (entry point).
      "/": () => MainPage,
      // Per-chain pages: <chain>/histogram + <chain>/table for consistency.
      // Heavy's table is "/" so we don't need a separate /heavy/table route.
      "/convergence/heavy": () => HeavyChainPage,
      "/convergence/light/table": () => LightTablePage,
      "/convergence/light": () => LightChainPage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

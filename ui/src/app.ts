import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import HeavyChainPage from "./pages/HeavyChainPage.vue";
import MainPage from "./pages/MainPage.vue";

export const sdkPlugin = defineAppV3(platforma, () => {
  return {
    routes: {
      "/": () => MainPage,
      "/convergence/heavy": () => HeavyChainPage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

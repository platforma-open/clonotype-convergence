<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// R67 — restrict GraphMaker's value picker to nbFreq only.
const nbFreqOnly = (spec: { name: string }) => spec.name === "pl7.app/vdj/convergence/nbFreq";

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.lightHistogramPfPcols;
  if (!pcols) return undefined;
  const nbFreq = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/nbFreq",
  );
  if (!nbFreq) return undefined;
  const fastStar = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/fastStar",
  );
  const defaults: PredefinedGraphOption<"histogram">[] = [
    {
      inputName: "value",
      selectedSource: nbFreq.spec,
    },
    {
      inputName: "tabBy",
      selectedSource: nbFreq.spec.axesSpec[0],
    },
  ];
  if (fastStar) {
    defaults.push({
      inputName: "grouping",
      selectedSource: fastStar.spec,
    });
  }
  return defaults;
});
</script>

<template>
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateHistogramLight"
      chartType="histogram"
      :p-frame="app.model.outputs.lightHistogramPf"
      :default-options="defaultOptions"
      :data-column-predicate="nbFreqOnly"
    />
  </PlBlockPage>
</template>

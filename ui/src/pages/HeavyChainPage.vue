<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Pre-fill GraphMaker with the heavy-chain nbFreq column as `value`
// and the sampleId axis (axesSpec[0]) as `facetBy` so the user gets
// a per-sample histogram facet out of the box (R46). The threshold
// dashed line is auto-rendered by GraphMaker from the
// `pl7.app/graph/thresholds` annotation that workflow already emits
// on this column (R48).

// R67 — restrict GraphMaker's value picker to nbFreq only.
// Default predicate would surface fastStar/neighbours/upstream cols
// which aren't meaningful as the chart's continuous value.
const nbFreqOnly = (spec: { name: string }) => spec.name === "pl7.app/vdj/convergence/nbFreq";

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.histogramPfPcols;
  if (!pcols) return undefined;
  const nbFreq = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/nbFreq",
  );
  if (!nbFreq) return undefined;
  return [
    {
      inputName: "value",
      selectedSource: nbFreq.spec,
    },
    {
      inputName: "facetBy",
      selectedSource: nbFreq.spec.axesSpec[0],
    },
  ];
});
</script>

<template>
  <!-- No PlBlockPage #title slot — GraphMaker's own chart title serves
       as the page title. `no-page-gutter` avoids double-padding since
       GraphMaker has its own perimeter offsets. -->
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateHistogramHeavy"
      chartType="histogram"
      :p-frame="app.model.outputs.histogramPf"
      :default-options="defaultOptions"
      :data-column-predicate="nbFreqOnly"
    />
  </PlBlockPage>
</template>

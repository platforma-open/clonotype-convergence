<script setup lang="ts">
import { GraphMaker } from "@milaboratories/graph-maker";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";
import { distributionDefaults, isScoreColumn } from "../distribution";

const app = useApp();

// Per-sample distribution (A-0015): one selector-driven histogram over the
// per-sample convergence scores across chain × mode (nbFreq / fullStarScore).
// The user picks the score; grouping is its matching hit. A threshold line
// appears when a fast-STAR score (nbFreq, which carries the threshold
// annotation) is selected; full-STAR scores carry none (the cutoff is the FDR
// call).
// tabByFirstAxis → tab by the score's sampleId axis, so the user gets one
// histogram facet per sample by default.
const defaultOptions = computed(() =>
  distributionDefaults(app.model.outputs.perSampleDistributionPfPcols, { tabByFirstAxis: true }),
);
</script>

<template>
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStatePerSample"
      chartType="histogram"
      :p-frame="app.model.outputs.perSampleDistributionPf"
      :default-options="defaultOptions"
      :data-column-predicate="isScoreColumn"
    />
  </PlBlockPage>
</template>

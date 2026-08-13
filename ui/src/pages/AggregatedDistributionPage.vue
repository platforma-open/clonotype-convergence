<script setup lang="ts">
import { GraphMaker } from "@milaboratories/graph-maker";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";
import { distributionDefaults, isScoreColumn } from "../distribution";

const app = useApp();

// Aggregated distribution (A-0015): one selector-driven histogram over the
// exported clonotype-only scores across chain × mode (nbFreq / fullStarScore).
// The user picks the score; grouping is its matching hit. Both aggregated
// scores stay on their per-sample statistic's scale, so nbFreq keeps its
// threshold line (the fast-STAR hit cuts exactly that aggregated value) while
// fullStarScore has none — its cutoff is the FDR call.
const defaultOptions = computed(() =>
  distributionDefaults(app.model.outputs.aggregatedDistributionPfPcols),
);
</script>

<template>
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateAggregated"
      chartType="histogram"
      :p-frame="app.model.outputs.aggregatedDistributionPf"
      :default-options="defaultOptions"
      :data-column-predicate="isScoreColumn"
    />
  </PlBlockPage>
</template>

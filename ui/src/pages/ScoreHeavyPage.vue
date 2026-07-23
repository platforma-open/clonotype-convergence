<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Aggregated-score histogram (A-0015): the distribution of the exported
// clonotype-only `starScore` (one value per clonotype), grouped by `starHit`, so
// the user sees how the hit set separates. Method-agnostic (the unified score);
// no threshold line — the hit is the >= k / BH call, not a starScore cutoff.
const starScoreOnly = (spec: { name: string }) => spec.name === "pl7.app/vdj/convergence/starScore";

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.scoreHistogramPfHeavyPcols;
  if (!pcols) return undefined;
  const starScore = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/starScore",
  );
  if (!starScore) return undefined;
  const starHit = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/starHit",
  );
  const defaults: PredefinedGraphOption<"histogram">[] = [
    { inputName: "value", selectedSource: starScore.spec },
  ];
  if (starHit) {
    defaults.push({ inputName: "grouping", selectedSource: starHit.spec });
  }
  return defaults;
});
</script>

<template>
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateScoreHeavy"
      chartType="histogram"
      :p-frame="app.model.outputs.scoreHistogramPfHeavy"
      :default-options="defaultOptions"
      :data-column-predicate="starScoreOnly"
    />
  </PlBlockPage>
</template>

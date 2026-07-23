<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Light-chain aggregated-score histogram — see ScoreHeavyPage.
const starScoreOnly = (spec: { name: string }) => spec.name === "pl7.app/vdj/convergence/starScore";

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.scoreHistogramPfLightPcols;
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
      v-model="app.model.data.graphStateScoreLight"
      chartType="histogram"
      :p-frame="app.model.outputs.scoreHistogramPfLight"
      :default-options="defaultOptions"
      :data-column-predicate="starScoreOnly"
    />
  </PlBlockPage>
</template>

<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Pre-fill GraphMaker with the heavy-chain starScore column as `value`
// and the sampleId axis (axesSpec[0]) as `tabBy` so the user gets a
// per-sample histogram tab out of the box. In fast-STAR fallback the
// value is nbFreq and GraphMaker auto-renders the threshold dashed line
// from the `pl7.app/graph/thresholds` annotation the workflow emits; in
// full-STAR the value is -log10(p) and that annotation is absent, so no
// threshold line appears (the cutoff is the per-sample FDR call).

// Restrict GraphMaker's value picker to starScore only. The default
// predicate would surface starHit/neighbours/upstream cols which aren't
// meaningful as the chart's continuous value.
const starScoreOnly = (spec: { name: string }) => spec.name === "pl7.app/vdj/convergence/starScore";

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.histogramPfPcols;
  if (!pcols) return undefined;
  const starScore = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/starScore",
  );
  if (!starScore) return undefined;
  // Group bars by starHit (Hit / Not hit) when the column is available —
  // makes the convergence call visually explicit.
  const starHit = pcols.find(
    (p: PColumnIdAndSpec) => p.spec.name === "pl7.app/vdj/convergence/starHit",
  );
  const defaults: PredefinedGraphOption<"histogram">[] = [
    {
      inputName: "value",
      selectedSource: starScore.spec,
    },
    {
      inputName: "tabBy",
      selectedSource: starScore.spec.axesSpec[0],
    },
  ];
  if (starHit) {
    defaults.push({
      inputName: "grouping",
      selectedSource: starHit.spec,
    });
  }
  return defaults;
});
</script>

<template>
  <!-- No PlBlockPage #title slot — GraphMaker's own chart title serves
       as the page title. `no-body-gutters` avoids double-padding since
       GraphMaker has its own perimeter offsets. -->
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateHistogramHeavy"
      chartType="histogram"
      :p-frame="app.model.outputs.histogramPf"
      :default-options="defaultOptions"
      :data-column-predicate="starScoreOnly"
    />
  </PlBlockPage>
</template>

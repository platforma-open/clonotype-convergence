<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Pre-fill GraphMaker with the heavy-chain nbFreq column as `value`
// and the sampleId axis (axesSpec[0]) as `tabBy` so the user gets a
// per-sample histogram switcher out of the box (R46). The threshold
// dashed line is auto-rendered by GraphMaker from the
// `pl7.app/graph/thresholds` annotation that workflow already emits
// on this column (R48).
// R49 — live hit-count badge. Reflects the LAST-RUN threshold (same
// as the histogram's dashed line); derived from the workflow's
// fastStar column.
const hitStats = computed(() => app.model.outputs.heavyHitStats);

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
      inputName: "tabBy",
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
    >
      <template
        v-if="hitStats && (hitStats.above > 0 || (hitStats.beforeCluster ?? 0) > 0)"
        #titleLineSlot
      >
        <span :class="$style.hitStats">
          <template v-if="hitStats.beforeCluster !== undefined">
            {{ hitStats.beforeCluster.toLocaleString() }} above threshold ·
            {{ hitStats.above.toLocaleString() }} passed cluster filter (of
            {{ hitStats.total.toLocaleString() }}, all samples)
          </template>
          <template v-else>
            {{ hitStats.above.toLocaleString() }} of {{ hitStats.total.toLocaleString() }}
            above threshold (all samples)
          </template>
        </span>
      </template>
    </GraphMaker>
  </PlBlockPage>
</template>

<style module>
.hitStats {
  display: flex;
  align-items: center;
  opacity: 0.7;
  font-size: 0.9em;
}
</style>

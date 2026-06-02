<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";
import { PlBlockPage } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// See HeavyChainPage — mirrored badge for the light-chain hit count.
const hitStats = computed(() => app.model.outputs.lightHitStats);

const defaultOptions = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const pcols = app.model.outputs.lightHistogramPfPcols;
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
  <PlBlockPage no-body-gutters>
    <GraphMaker
      v-model="app.model.data.graphStateHistogramLight"
      chartType="histogram"
      :p-frame="app.model.outputs.lightHistogramPf"
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

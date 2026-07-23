<script setup lang="ts">
import { PlAgDataTableV2, PlBlockPage, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "../app";

const app = useApp();

// Clonotype-only aggregated EXPORT table (A-0011): one row per clonotype with
// the downstream-consumable starScore / starHit / support. No sample sheet —
// the sampleId axis is collapsed away by the aggregation.
const tableSettings = usePlDataTableSettingsV2({
  sourceId: () => app.model.outputs.mainTableSourceId,
  model: () => app.model.outputs.aggregatedTable,
});
</script>

<template>
  <PlBlockPage>
    <template #title>Aggregated convergence (export)</template>
    <PlAgDataTableV2
      v-model="app.model.data.aggregatedTableState"
      :settings="tableSettings"
      show-columns-panel
      show-export-button
      :loading-text="app.model.outputs.isRunning ? 'Running' : undefined"
      not-ready-text="Run the block to see the clonotype-level aggregated export."
    />
  </PlBlockPage>
</template>

<script setup lang="ts">
import { PlAgDataTableV2, PlBlockPage, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "../app";

const app = useApp();

// Per-sample table: v1's internal per-sample family with the
// single-sample sheet selector, for inspecting a clonotype's convergence signal
// sample by sample. `sheets` adds the sample picker (SDK pins to one sample at a
// time). This is the internal per-sample view, distinct from the aggregated,
// clonotype-only Main table that downstream consumes.
const tableSettings = usePlDataTableSettingsV2({
  sourceId: () => app.model.outputs.mainTableSourceId,
  model: () => app.model.outputs.mainTable,
  sheets: () => app.model.outputs.mainTableSheets,
});
</script>

<template>
  <PlBlockPage>
    <template #title>Per-sample table</template>
    <PlAgDataTableV2
      v-model="app.model.data.mainTableState"
      :settings="tableSettings"
      show-columns-panel
      show-export-button
      :loading-text="app.model.outputs.isRunning ? 'Running' : undefined"
      not-ready-text="Run the block to inspect the per-sample convergence signal."
    />
  </PlBlockPage>
</template>

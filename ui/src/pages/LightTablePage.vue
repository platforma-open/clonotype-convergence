<script setup lang="ts">
import { PlAgDataTableV2, PlBlockPage, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Light-chain convergence table — anchored on the LC ref. Heavy + LC
// convergence columns can't share one table because they're on
// different clonotypeKey axes (chain domain differs); this is the
// LC-side mirror of the heavy table on "/".
const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.lightMainTable,
});

// See MainPage.vue: coerce undefined → '' so PlBlockPage's
// `v-if="subtitle !== undefined"` keeps the subtitle row rendered for
// existing block instances created before customBlockLabel was added.
const customBlockLabel = computed({
  get: () => app.model.data.customBlockLabel ?? "",
  set: (v: string) => {
    app.model.data.customBlockLabel = v;
  },
});
</script>

<template>
  <PlBlockPage
    v-model:subtitle="customBlockLabel"
    :subtitle-placeholder="app.model.outputs.subtitleText ?? ''"
    title="Light clonotype table"
  >
    <PlAgDataTableV2
      v-model="app.model.data.lightMainTableState"
      :settings="tableSettings"
      show-columns-panel
      show-export-button
      not-ready-text="No light-chain results yet — press Run with a light chain picked."
    />
  </PlBlockPage>
</template>

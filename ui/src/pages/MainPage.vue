<script setup lang="ts">
import {
  PlAgDataTableV2,
  PlBlockPage,
  PlBtnGhost,
  PlMaskIcon24,
  PlSlideModal,
  usePlDataTableSettingsV2,
} from "@platforma-sdk/ui-vue";
import { computed, reactive, watch } from "vue";
import { useApp } from "../app";
import LogsPanel from "./LogsPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";

const app = useApp();

// Modal open state — kept in a local reactive (not in BlockData) so a
// hairpin-free auto-close on Run state change is possible without
// writing to server-stored data (hairpin.md). Auto-open on first
// project add (no inputRef yet) is initialised here, per R53.
const ui = reactive({
  activePanel:
    app.model.data.inputRef === undefined ? "settings" : (null as "settings" | "logs" | null),
});

const settingsOpen = computed({
  get: () => ui.activePanel === "settings",
  set: (v: boolean) => {
    ui.activePanel = v ? "settings" : null;
  },
});

const logsOpen = computed({
  get: () => ui.activePanel === "logs",
  set: (v: boolean) => {
    ui.activePanel = v ? "logs" : null;
  },
});

// Auto-close the Settings modal when a run starts — mirrors the
// clonotype-space / immune-assay-data pattern. Logs stay open since
// they're the relevant panel during a run.
watch(
  () => app.model.outputs.isRunning,
  (isRunning, wasRunning) => {
    if (isRunning && !wasRunning && ui.activePanel === "settings") {
      ui.activePanel = null;
    }
  },
);

// PlAgDataTableV2 settings — bound to the model's mainTable output (R52).
const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.mainTable,
});

// PlBlockPage hides the entire subtitle row when v-model:subtitle is
// `undefined` (`<div v-if="subtitle !== undefined">` in its template).
// Existing block instances created before `customBlockLabel` was added
// to the schema have it as `undefined`, which would suppress the
// placeholder line entirely. Coerce undefined → '' here so the row
// renders and the chain/threshold placeholder shows in grey.
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
    title="Clonotype Convergence"
  >
    <template #append>
      <PlBtnGhost @click.stop="() => (ui.activePanel = 'logs')">
        Logs
        <template #append>
          <PlMaskIcon24 name="file-logs" />
        </template>
      </PlBtnGhost>
      <PlBtnGhost @click.stop="() => (ui.activePanel = 'settings')">
        Settings
        <template #append>
          <PlMaskIcon24 name="settings" />
        </template>
      </PlBtnGhost>
    </template>

    <PlAgDataTableV2
      v-model="app.model.data.mainTableState"
      :settings="tableSettings"
      show-columns-panel
      show-export-button
      :loading-text="app.model.outputs.isRunning ? 'Running' : undefined"
      not-ready-text="Select an input dataset and press Run to see clonotypes."
    />
  </PlBlockPage>

  <PlSlideModal v-model="settingsOpen" :shadow="true" width="40%">
    <template #title>Settings</template>
    <SettingsPanel />
  </PlSlideModal>

  <PlSlideModal v-model="logsOpen" :shadow="true" width="60%">
    <template #title>Run logs</template>
    <LogsPanel />
  </PlSlideModal>
</template>

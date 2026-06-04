<script setup lang="ts">
import {
  PlAgDataTableV2,
  PlBlockPage,
  PlBtnGhost,
  PlDialogModal,
  PlMaskIcon24,
  PlSlideModal,
  usePlDataTableSettingsV2,
} from "@platforma-sdk/ui-vue";
import { computed, reactive, watch } from "vue";
import { useApp } from "../app";
import LogsPanel from "./LogsPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import StatsPanel from "./StatsPanel.vue";

const app = useApp();

type Panel = "settings" | "logs" | "stats" | null;

// Modal open state — kept in a local reactive (not in BlockData) so a
// hairpin-free auto-close on Run state change is possible without
// writing to server-stored data (hairpin.md). Auto-open on first
// project add (no mainRef yet) is initialised here, per R53.
const ui = reactive({
  activePanel: (app.model.data.mainRef === undefined ? "settings" : null) as Panel,
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

const statsOpen = computed({
  get: () => ui.activePanel === "stats",
  set: (v: boolean) => {
    ui.activePanel = v ? "stats" : null;
  },
});

// R68 — show the Stats button only when at least one chain produced
// stats. Mirrors the badge's previous visibility gate (R49) but
// promoted from histogram-page corner to main-page header.
const hasAnyStats = computed(
  () => !!app.model.outputs.heavyHitStats || !!app.model.outputs.lightHitStats,
);

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
// `sheets` adds the sample picker above the table (one sample at a
// time; SDK pins to a single value).
const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.mainTable,
  sheets: () => app.model.outputs.mainTableSheets,
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
      <PlBtnGhost v-if="hasAnyStats" @click.stop="() => (ui.activePanel = 'stats')">
        Stats
        <template #append>
          <PlMaskIcon24 name="statistics" />
        </template>
      </PlBtnGhost>
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
      not-ready-text="Select an input dataset and press Run to see clonotypes."
    />
  </PlBlockPage>

  <PlSlideModal v-model="settingsOpen" :shadow="true">
    <template #title>Settings</template>
    <SettingsPanel />
  </PlSlideModal>

  <PlSlideModal v-model="logsOpen" :shadow="true" width="60%">
    <template #title>Run logs</template>
    <LogsPanel />
  </PlSlideModal>

  <PlDialogModal v-model="statsOpen" :width="`448px`" :close-on-outside-click="true">
    <template #title>
      <div>
        <div>Hit statistics</div>
        <div :class="$style.statsSubtitle">
          Aggregated across all samples for the configured threshold(s).
        </div>
      </div>
    </template>
    <StatsPanel />
  </PlDialogModal>
</template>

<style module>
.statsSubtitle {
  color: var(--txt-02, #6b7280);
  font-size: 14px;
  margin-top: 4px;
  line-height: 1.2;
  font-weight: normal;
}
</style>

<script setup lang="ts">
import {
  PlAgDataTableV2,
  PlAlert,
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
// writing to server-stored data. Auto-open Settings on first project
// add (no dataset yet).
const ui = reactive({
  activePanel: (app.model.data.datasetRef === undefined ? "settings" : null) as Panel,
});

// Single mutation path (only one panel is open at a time). Header buttons open
// via setPanel(name); each modal's v-model closes via the factory below, which
// routes back through setPanel(null).
function setPanel(panel: Panel) {
  ui.activePanel = panel;
}

// One v-model per modal, from a factory so the three stay identical. The setter
// only CLOSES — panels are opened via setPanel from the header buttons; the
// `name` guard stops a late close event from nulling a panel opened since.
function panelModel(name: Exclude<Panel, null>) {
  return computed({
    get: () => ui.activePanel === name,
    set: (open: boolean) => {
      if (!open && ui.activePanel === name) setPanel(null);
    },
  });
}
const settingsOpen = panelModel("settings");
const logsOpen = panelModel("logs");
const statsOpen = panelModel("stats");

// Show the Stats button only when at least one chain produced stats.
const hasAnyStats = computed(
  () => !!app.model.outputs.heavyHitStats || !!app.model.outputs.lightHitStats,
);

// Skipped-samples warning. `belowMin` lists samples that had CDR3 data
// but fewer unique nts than the nMin floor — surfaced with advice to
// adjust nMin. The chain-wide "no usable data" case is surfaced
// separately via `allEmpty` (see below).
const skippedBelowMin = computed<string[]>(() => {
  const heavy = app.model.outputs.heavySkippedSamples?.belowMin ?? [];
  const light = app.model.outputs.lightSkippedSamples?.belowMin ?? [];
  return Array.from(new Set([...heavy, ...light]));
});
const skippedNMin = computed<number | undefined>(
  () => app.model.outputs.heavySkippedSamples?.nMin ?? app.model.outputs.lightSkippedSamples?.nMin,
);

// Samples dropped because they have NO usable CDR3 (nUniqueNt == 0), distinct
// from `belowMin` — lowering nMin won't recover these, so the message omits
// the nMin advice. Union across chains.
const skippedNoCdr3 = computed<string[]>(() => {
  const heavy = app.model.outputs.heavySkippedSamples?.noCdr3 ?? [];
  const light = app.model.outputs.lightSkippedSamples?.noCdr3 ?? [];
  return Array.from(new Set([...heavy, ...light]));
});

// "All empty" — the chain ran but produced nothing usable AND has no
// per-sample skip reason to explain it (every input row had null /
// empty CDR3s). Chain-attributed so the user knows which chain is
// the problem in dual-chain mode. This warns about missing CDR3 DATA (a
// real input problem), NOT about empty Pgen — an empty Pgen with good CDR3
// just yields an empty full-STAR table, no special warning.
const heavyAllEmpty = computed(() => app.model.outputs.heavySkippedSamples?.allEmpty === true);
const lightAllEmpty = computed(() => app.model.outputs.lightSkippedSamples?.allEmpty === true);

// fast-STAR fallback: the last run used the threshold-based call for a
// processed chain (no Pgen) instead of FDR-controlled full-STAR (A-0010).
// From activeArgs (what actually ran), so it matches the shown results.
const inFallback = computed(() => app.model.outputs.ranFallback === true);

// Auto-close the Settings modal when a Run commits. `runArgsId` (model output
// over activeArgs) changes only when a Run actually commits new args, so this
// fires once per run regardless of duration, dedup, or SDK timing — including
// fast/cached recomputes (threshold, export sample). Logs stay open since
// they're the relevant panel during a run.
watch(
  () => app.model.outputs.runArgsId,
  (id, prev) => {
    if (id && id !== prev && ui.activePanel === "settings") {
      setPanel(null);
    }
  },
);

// PlAgDataTableV2 settings — bound to the model's mainTable output.
// `sheets` adds the sample picker above the table (one sample at a
// time; SDK pins to a single value).
// `sourceId` is keyed on `mainTableSourceId` — a model output that
// derives from `activeArgs`, NOT from the live edit state. That way
// the per-source state cache (hidden columns, sort, filters) only
// flips when a Run actually commits new args; picking a new dataset
// before pressing Run doesn't reload the table or wipe its state.
const tableSettings = usePlDataTableSettingsV2({
  sourceId: () => app.model.outputs.mainTableSourceId,
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
      <PlBtnGhost v-if="hasAnyStats" @click.stop="() => setPanel('stats')">
        Stats
        <template #append>
          <PlMaskIcon24 name="statistics" />
        </template>
      </PlBtnGhost>
      <PlBtnGhost @click.stop="() => setPanel('logs')">
        Logs
        <template #append>
          <PlMaskIcon24 name="file-logs" />
        </template>
      </PlBtnGhost>
      <PlBtnGhost @click.stop="() => setPanel('settings')">
        Settings
        <template #append>
          <PlMaskIcon24 name="settings" />
        </template>
      </PlBtnGhost>
    </template>

    <PlAlert v-if="inFallback" type="warn" icon>
      <template #title>Pgen not available — showing fast-STAR</template>
      Generation Probability wasn't found for this input, so convergence is called by the
      threshold-based fast-STAR method (<b>not</b> FDR-controlled). Run the Generation Probability
      block on this dataset to enable full-STAR.
    </PlAlert>

    <PlAlert v-if="skippedBelowMin.length > 0" type="warn" icon>
      <template #title>
        {{ skippedBelowMin.length }} sample{{ skippedBelowMin.length === 1 ? "" : "s" }} below
        minimum
      </template>
      {{ skippedBelowMin.length === 1 ? "This sample has" : "These samples have" }}
      fewer than {{ skippedNMin }} unique nucleotide CDR3 sequences and
      {{ skippedBelowMin.length === 1 ? "was" : "were" }} skipped: {{ skippedBelowMin.join(", ") }}.
      Adjust "Minimum unique CDR3 per sample" in Advanced settings to include
      {{ skippedBelowMin.length === 1 ? "it" : "them" }}.
    </PlAlert>

    <PlAlert v-if="skippedNoCdr3.length > 0" type="warn" icon>
      <template #title>
        {{ skippedNoCdr3.length }} sample{{ skippedNoCdr3.length === 1 ? "" : "s" }} with no usable
        CDR3
      </template>
      {{ skippedNoCdr3.length === 1 ? "This sample has" : "These samples have" }}
      no usable CDR3 sequences and
      {{ skippedNoCdr3.length === 1 ? "was" : "were" }} skipped: {{ skippedNoCdr3.join(", ") }}.
    </PlAlert>

    <PlAlert v-if="heavyAllEmpty" type="warn" icon>
      <template #title>No heavy-chain data</template>
      No samples had usable CDR3 data for the heavy chain. Check the upstream input.
    </PlAlert>

    <PlAlert v-if="lightAllEmpty" type="warn" icon>
      <template #title>No light-chain data</template>
      No samples had usable CDR3 data for the light chain. Check the upstream input.
    </PlAlert>

    <PlAgDataTableV2
      v-model="app.model.data.mainTableState"
      :settings="tableSettings"
      show-columns-panel
      show-export-button
      :loading-text="app.model.outputs.isRunning ? 'Running' : undefined"
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
          Aggregated across all samples for the current settings.
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

<script setup lang="ts">
import { PlAccordion, PlAccordionSection, PlLogView, PlTabs } from "@platforma-sdk/ui-vue";
import { computed, reactive, ref } from "vue";
import { useApp } from "../app";

const app = useApp();

// Per-sample logs from the per-sample fan-out (one compute-neighbours stdout
// per sample), each tagged with its real sample label by the model.
const heavy = computed(() => app.model.outputs.perSampleLogsHeavy ?? []);
const light = computed(() => app.model.outputs.perSampleLogsLight ?? []);
const dualChain = computed(() => heavy.value.length > 0 && light.value.length > 0);
const hasAny = computed(() => heavy.value.length > 0 || light.value.length > 0);
const isRunning = computed(() => app.model.outputs.isRunning);

// Heavy/light tab, shown only in dual-chain mode. View-local (a plain ref, not
// persisted) — the labels match the settings fields (Heavy-chain / Light-chain).
const activeChain = ref<"heavy" | "light">("heavy");
const chainTabs = [
  { value: "heavy", label: "Heavy-chain" },
  { value: "light", label: "Light-chain" },
];

// Which chain's logs to show: the active tab in dual-chain mode, otherwise
// whichever single chain produced logs.
const shownChain = computed<"heavy" | "light">(() =>
  dualChain.value ? activeChain.value : light.value.length > 0 ? "light" : "heavy",
);
const shownLogs = computed(() => (shownChain.value === "light" ? light.value : heavy.value));

// Per-sample accordion open state, keyed by "<chain>:<sampleId>" so heavy and
// light keep independent state. Unset = expanded (logs start open).
const open = reactive<Record<string, boolean>>({});
const isOpen = (sampleId: string) => open[`${shownChain.value}:${sampleId}`] ?? true;
const setOpen = (sampleId: string, v: boolean) => {
  open[`${shownChain.value}:${sampleId}`] = v;
};
</script>

<template>
  <div v-if="hasAny" :class="$style.logsPanel">
    <PlTabs v-if="dualChain" v-model="activeChain" :options="chainTabs" :class="$style.tabs" />
    <!-- `multiple` is required: standalone PlAccordionSection ignores its
         v-model and defaults closed; only inside <PlAccordion multiple> does
         each section's open state follow model-value (default expanded). -->
    <PlAccordion multiple>
      <PlAccordionSection
        v-for="s in shownLogs"
        :key="s.sampleId"
        :label="s.label"
        :model-value="isOpen(s.sampleId)"
        @update:model-value="(v: boolean) => setOpen(s.sampleId, v)"
      >
        <!-- `text` is the sample's full captured stdout, or undefined until the
             sample finishes — in which case "Starting…" shows and is replaced by
             the log in one step (no blink). Wrapper adds bottom spacing:
             PlAccordionSection gives children margin-top 24px but only
             margin-bottom 4px, so the log would otherwise sit tight against the
             next section header. -->
        <div :class="$style.logWrap">
          <PlLogView :value="s.text ?? 'Starting…'" />
        </div>
      </PlAccordionSection>
    </PlAccordion>
  </div>
  <p v-else-if="isRunning" :class="$style.runningHint">Calculations started.</p>
  <p v-else>Run the block to see logs.</p>
</template>

<style module>
.logsPanel {
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
}
.tabs {
  margin-bottom: 16px;
}
/* Balance the accordion's asymmetric child margins (24px top / 4px bottom) so
   each log has breathing room above the next section header. */
.logWrap {
  padding-bottom: 20px;
}
.runningHint {
  padding: 12px 16px;
  color: var(--txt-02, #555);
  font-size: 13px;
  line-height: 1.45;
}
</style>

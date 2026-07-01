<script setup lang="ts">
import { PlAccordion, PlAccordionSection, PlLogView } from "@platforma-sdk/ui-vue";
import { computed, reactive } from "vue";
import { useApp } from "../app";

const app = useApp();

// Per-sample logs from the per-sample fan-out (one compute-neighbours stdout
// per sample), each tagged with its real sample label by the model. Rendered
// as a collapsible list so a many-sample run stays navigable.
const heavy = computed(() => app.model.outputs.perSampleLogsHeavy ?? []);
const light = computed(() => app.model.outputs.perSampleLogsLight ?? []);
const dualChain = computed(() => heavy.value.length > 0 && light.value.length > 0);
const hasAny = computed(() => heavy.value.length > 0 || light.value.length > 0);
const isRunning = computed(() => app.model.outputs.isRunning);

// Per-sample accordion open state, keyed by sampleId. Unset = expanded (logs
// start open); the user can still collapse/expand each one.
const openHeavy = reactive<Record<string, boolean>>({});
const openLight = reactive<Record<string, boolean>>({});
</script>

<template>
  <div v-if="hasAny" :class="$style.logsPanel">
    <section v-if="heavy.length > 0">
      <h4 v-if="dualChain" :class="$style.heading">Heavy chain</h4>
      <!-- `multiple` is required: standalone PlAccordionSection ignores its
           v-model and defaults closed; only inside <PlAccordion multiple> does
           each section's open state follow model-value (default expanded). -->
      <PlAccordion multiple>
        <PlAccordionSection
          v-for="s in heavy"
          :key="s.sampleId"
          :label="s.label"
          :model-value="openHeavy[s.sampleId] ?? true"
          @update:model-value="(v: boolean) => (openHeavy[s.sampleId] = v)"
        >
          <!-- `text` is the sample's full captured stdout, or undefined until
               the sample finishes — in which case "Starting…" shows and is
               replaced by the log in one step (no blink). Wrapper adds bottom
               spacing: PlAccordionSection's content gives children margin-top
               24px but only margin-bottom 4px, so the log would otherwise sit
               tight against the next section header. -->
          <div :class="$style.logWrap">
            <PlLogView :value="s.text ?? 'Starting…'" />
          </div>
        </PlAccordionSection>
      </PlAccordion>
    </section>
    <section
      v-if="light.length > 0"
      :style="
        heavy.length > 0
          ? 'margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--border-color-div-grey, #e0e0e0);'
          : undefined
      "
    >
      <h4 v-if="dualChain" :class="$style.heading">Light chain</h4>
      <PlAccordion multiple>
        <PlAccordionSection
          v-for="s in light"
          :key="s.sampleId"
          :label="s.label"
          :model-value="openLight[s.sampleId] ?? true"
          @update:model-value="(v: boolean) => (openLight[s.sampleId] = v)"
        >
          <!-- `text` is the sample's full captured stdout, or undefined until
               the sample finishes — in which case "Starting…" shows and is
               replaced by the log in one step (no blink). Wrapper adds bottom
               spacing: PlAccordionSection's content gives children margin-top
               24px but only margin-bottom 4px, so the log would otherwise sit
               tight against the next section header. -->
          <div :class="$style.logWrap">
            <PlLogView :value="s.text ?? 'Starting…'" />
          </div>
        </PlAccordionSection>
      </PlAccordion>
    </section>
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
/* Balance the accordion's asymmetric child margins (24px top / 4px bottom) so
   each log has breathing room above the next section header. */
.logWrap {
  padding-bottom: 20px;
}
.heading {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--txt-02, #555);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.runningHint {
  padding: 12px 16px;
  color: var(--txt-02, #555);
  font-size: 13px;
  line-height: 1.45;
}
</style>

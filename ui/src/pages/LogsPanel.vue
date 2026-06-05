<script setup lang="ts">
import { PlLogView } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

const hasHeavy = computed(() => !!app.model.outputs.runLogsHeavy);
const hasLight = computed(() => !!app.model.outputs.runLogsLight);
const dualChain = computed(() => hasHeavy.value && hasLight.value);
const isRunning = computed(() => app.model.outputs.isRunning);
</script>

<template>
  <div v-if="hasHeavy || hasLight" :class="$style.logsPanel">
    <section v-if="hasHeavy">
      <h4 v-if="dualChain" :class="$style.heading">Heavy chain</h4>
      <PlLogView :log-handle="app.model.outputs.runLogsHeavy" />
    </section>
    <section
      v-if="hasLight"
      :style="
        hasHeavy
          ? 'margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--border-color-div-grey, #e0e0e0);'
          : undefined
      "
    >
      <h4 v-if="dualChain" :class="$style.heading">Light chain</h4>
      <PlLogView :log-handle="app.model.outputs.runLogsLight" />
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

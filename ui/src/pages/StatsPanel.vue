<script setup lang="ts">
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

type HitStats = { above: number; total: number; beforeCluster?: number };

const heavy = computed<HitStats | undefined>(() => app.model.outputs.heavyHitStats);
const light = computed<HitStats | undefined>(() => app.model.outputs.lightHitStats);
const dualChain = computed(() => !!heavy.value && !!light.value);

const fmt = (n: number) => n.toLocaleString();

type Row = { label: string; value: string };
function rowsFor(s: HitStats): Row[] {
  const rows: Row[] = [];
  if (s.beforeCluster !== undefined) {
    rows.push({ label: "Convergent hits", value: fmt(s.beforeCluster) });
    rows.push({ label: "Passed cluster filter", value: fmt(s.above) });
  } else {
    rows.push({ label: "Convergent hits", value: fmt(s.above) });
  }
  // "Total records" rather than "Total clonotypes": the underlying
  // counts come from the long-format (sampleId, clonotypeKey) frame,
  // so a clonotype shared by N samples contributes N records.
  rows.push({ label: "Total records (clonotype × sample)", value: fmt(s.total) });
  return rows;
}
</script>

<template>
  <div v-if="heavy || light" :class="$style.statsPanel">
    <section v-if="heavy">
      <div v-if="dualChain" :class="$style.heading">Heavy chain</div>
      <div :class="$style.table">
        <div :class="$style.headerRow">
          <div>Statistic</div>
          <div :class="$style.valueCol">Value</div>
        </div>
        <div v-for="row in rowsFor(heavy)" :key="row.label" :class="$style.row">
          <div>{{ row.label }}</div>
          <div :class="$style.valueCol">{{ row.value }}</div>
        </div>
      </div>
    </section>

    <section v-if="light" :class="heavy ? $style.sectionAfter : undefined">
      <div v-if="dualChain" :class="$style.heading">Light chain</div>
      <div :class="$style.table">
        <div :class="$style.headerRow">
          <div>Statistic</div>
          <div :class="$style.valueCol">Value</div>
        </div>
        <div v-for="row in rowsFor(light)" :key="row.label" :class="$style.row">
          <div>{{ row.label }}</div>
          <div :class="$style.valueCol">{{ row.value }}</div>
        </div>
      </div>
    </section>
  </div>
  <p v-else>Run the block to see hit statistics.</p>
</template>

<style module>
.statsPanel {
  display: flex;
  flex-direction: column;
}
.sectionAfter {
  margin-top: 24px;
}
.heading {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--txt-02, #555);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.table {
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color-div-grey, #e0e0e0);
}
.headerRow,
.row {
  display: grid;
  grid-template-columns: 1fr max-content;
  padding: 12px 16px;
  font-size: 14px;
}
.headerRow {
  background: var(--bg-base-light, #f6f7f9);
  font-weight: 600;
}
.row + .row,
.headerRow + .row {
  border-top: 1px solid var(--border-color-div-grey, #e0e0e0);
}
.valueCol {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>

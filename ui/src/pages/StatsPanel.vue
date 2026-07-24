<script setup lang="ts">
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

type HitStats = { above: number; total: number };
type StatSection = { heading: string; stats: HitStats };

// Per chain × per emitted mode (A-0015 v2): fast-STAR always, full-STAR where it
// ran. Counts are over the aggregated, clonotype-only export (one row per
// clonotype): `above` = clones called convergent across the repertoire,
// `total` = clonotypes.
const sections = computed<StatSection[]>(() => {
  const o = app.model.outputs;
  const out: StatSection[] = [];
  const add = (heading: string, s: HitStats | undefined) => {
    if (s) out.push({ heading, stats: s });
  };
  add("Heavy — fast-STAR", o.heavyFastStats);
  add("Heavy — full-STAR", o.heavyFullStats);
  add("Light — fast-STAR", o.lightFastStats);
  add("Light — full-STAR", o.lightFullStats);
  return out;
});

const fmt = (n: number) => n.toLocaleString();
</script>

<template>
  <div v-if="sections.length > 0" :class="$style.statsPanel">
    <section
      v-for="(sec, i) in sections"
      :key="sec.heading"
      :class="i > 0 ? $style.sectionAfter : undefined"
    >
      <div :class="$style.heading">{{ sec.heading }}</div>
      <div :class="$style.table">
        <div :class="$style.headerRow">
          <div>Statistic</div>
          <div :class="$style.valueCol">Value</div>
        </div>
        <div :class="$style.row">
          <div>Convergent clonotypes</div>
          <div :class="$style.valueCol">{{ fmt(sec.stats.above) }}</div>
        </div>
        <div :class="$style.row">
          <div>Total clonotypes</div>
          <div :class="$style.valueCol">{{ fmt(sec.stats.total) }}</div>
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

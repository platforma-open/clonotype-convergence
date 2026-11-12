<script setup lang="ts">
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

type HitStats = { above: number; total: number };
type StatSection = { heading: string; stats: HitStats };

// Per chain × per emitted mode: fast-STAR always, full-STAR where it
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

// Samples under nMin, union across chains (the main page's warning counts them).
const belowMin = computed(() => {
  const o = app.model.outputs;
  const samples = [
    ...(o.heavySkippedSamples?.belowMin ?? []),
    ...(o.lightSkippedSamples?.belowMin ?? []),
  ];
  return Array.from(new Set(samples)).sort((a, b) => a.localeCompare(b));
});
const belowMinNMin = computed(
  () => app.model.outputs.heavySkippedSamples?.nMin ?? app.model.outputs.lightSkippedSamples?.nMin,
);

// Per-isotype compartments under nMin, one row per chain and isotype. Not
// merged across chains: each chain counts its own unique nucleotide CDR3s, so
// on single-cell data one chain's compartment can be skipped while the other's
// is scored.
const isotypeSkipped = computed(() =>
  (app.model.outputs.isotypeSkippedSamples?.entries ?? []).map((e) => ({
    key: `${e.chain}:${e.isotype}`,
    label: `${e.chain === "heavy" ? "Heavy" : "Light"} ${e.isotype}`,
    samples: e.samples,
  })),
);

const fmt = (n: number) => n.toLocaleString();
</script>

<template>
  <div
    v-if="sections.length > 0 || belowMin.length > 0 || isotypeSkipped.length > 0"
    :class="$style.statsPanel"
  >
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
    <section
      v-if="belowMin.length > 0"
      :class="sections.length > 0 ? $style.sectionAfter : undefined"
    >
      <div :class="$style.heading">Samples below minimum</div>
      <p :class="$style.note">Skipped: fewer than {{ belowMinNMin }} unique nucleotide CDR3s.</p>
      <div :class="$style.table">
        <div :class="$style.headerRow">
          <div>Sample</div>
        </div>
        <div v-for="name in belowMin" :key="name" :class="$style.row">
          <div>{{ name }}</div>
        </div>
      </div>
    </section>
    <section
      v-if="isotypeSkipped.length > 0"
      :class="sections.length > 0 || belowMin.length > 0 ? $style.sectionAfter : undefined"
    >
      <div :class="$style.heading">Per-isotype scores skipped</div>
      <p :class="$style.note">
        Fewer than {{ app.model.outputs.isotypeSkippedSamples?.nMin }} unique nucleotide CDR3s of
        the isotype in the sample.
      </p>
      <div :class="$style.table">
        <div :class="[$style.headerRow, $style.listRow]">
          <div>Isotype</div>
          <div>Samples</div>
        </div>
        <div v-for="e in isotypeSkipped" :key="e.key" :class="[$style.row, $style.listRow]">
          <div>{{ e.label }}</div>
          <div>{{ e.samples.join(", ") }}</div>
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
.note {
  margin: 0 0 10px;
  font-size: 14px;
}
.listRow {
  /* Each row is its own grid, so a fixed first column keeps the lists aligned. */
  grid-template-columns: 96px 1fr;
  column-gap: 16px;
}
.valueCol {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>

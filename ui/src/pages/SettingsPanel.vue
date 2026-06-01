<script setup lang="ts">
import type { PlRef } from "@platforma-sdk/model";
import { PlAccordionSection, PlAlert, PlDropdownRef, PlNumberField } from "@platforma-sdk/ui-vue";
import canonicalize from "canonicalize";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// Snapshot pattern (R8): when the user picks a new dataset, write BOTH
// `data.inputRef` AND `data.inputDerivedFacts` in the same user-gesture
// handler. Reads from the model's factsByRef map keyed by canonical
// PlRef. No watcher-driven hairpin — args lambda validates from
// `data.inputDerivedFacts` alone.
function onPickInput(ref: PlRef | undefined) {
  if (ref === undefined) {
    app.model.data.inputRef = undefined;
    app.model.data.inputDerivedFacts = undefined;
    return;
  }
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  const facts = key === undefined ? undefined : app.model.outputs.factsByRef?.[key];
  app.model.data.inputRef = ref;
  app.model.data.inputDerivedFacts = facts;
}

// Live PlAlert mirror (R9). In the happy path the alert stays hidden —
// the dropdown filter restricts options to valid candidates. The alert
// surfaces when the snapshot in `data.inputDerivedFacts` no longer
// matches the upstream pool (e.g. user picked an input, then the
// upstream block re-ran with different chains).
// Mirror exactly the args lambda's chain naming (IGHeavy domain value,
// not the IGH per-row code from `topChains`). Each MiXCR anchor is
// chain-specific; we only accept the dataset's IGHeavy anchor for now.
// Light-chain handling is Phase 7.
const alertMessage = computed<string | undefined>(() => {
  const live = app.model.outputs.upstreamFacts;
  if (live === undefined) return undefined;
  if (app.model.data.inputRef === undefined) return undefined;

  const tcr = live.chains.filter((c) => c.startsWith("TCR"));
  if (tcr.length > 0) {
    return `Selected input contains TCR chains (${tcr.join(", ")}); this block is BCR-only.`;
  }
  const chain = live.chains[0];
  if (live.chains.length === 0) {
    return "Selected input has no detectable chain — re-select an input.";
  }
  if (live.chains.length > 1) {
    return `Selected input spans multiple chains (${live.chains.join(", ")}).`;
  }
  if (chain !== "IGHeavy") {
    return `Selected input chain is "${chain}", not IGHeavy. Pick the IG Heavy anchor — light chain support is Phase 7.`;
  }
  if (!live.hasAaCDR3 || !live.hasNtCDR3) {
    return "Selected input is missing required CDR3 columns — re-select an input.";
  }
  if (!live.hasAbundance) {
    return "Selected input has no abundance column — re-select an input.";
  }
  return undefined;
});
</script>

<template>
  <PlDropdownRef
    :options="app.model.outputs.datasetOptions"
    :model-value="app.model.data.inputRef"
    label="Input dataset (BCR clonotyping run)"
    clearable
    @update:model-value="onPickInput"
  />

  <PlAlert v-if="alertMessage" type="warn">
    {{ alertMessage }}
  </PlAlert>

  <PlNumberField
    :model-value="app.model.data.threshold"
    label="Heavy-chain threshold (Nb_freq cutoff)"
    helper="Default 0.000961 — Abbate et al. 2024 ≈5% FDR on human IgH. Recalibrate visually on the histogram for non-human / non-IgH data."
    :min="0"
    :max="1"
    :step="0.0001"
    @update:model-value="(v) => (app.model.data.threshold = v)"
  />

  <PlAccordionSection label="Advanced settings">
    <PlNumberField
      :model-value="app.model.data.nMin"
      label="Minimum unique nt CDR3 per sample"
      helper="Default 100. Samples with fewer unique nt CDR3s are skipped — below this the neighbour density math degenerates."
      :min="1"
      :step="1"
      @update:model-value="(v) => (app.model.data.nMin = v)"
    />
  </PlAccordionSection>
</template>

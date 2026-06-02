<script setup lang="ts">
import { plRefsEqual, type PlRef } from "@platforma-sdk/model";
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
    app.model.data.lightChainPick = undefined;
    app.model.data.lightChainRef = undefined;
    return;
  }
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  const facts = key === undefined ? undefined : app.model.outputs.factsByRef?.[key];
  app.model.data.inputRef = ref;
  app.model.data.inputDerivedFacts = facts;
  // Drop the previous LC pick — different dataset.
  app.model.data.lightChainPick = undefined;
  app.model.data.lightChainRef = undefined;
}

// Light-chain picker options. Model returns array of {ref, label, chain};
// we map to PlDropdownRef's expected {ref, label} shape so labels match
// what users see in the input dataset picker (e.g. "IG Light").
const lightChainDropdownOptions = computed(() =>
  (app.model.outputs.lightChainOptions ?? []).map((o) => ({
    ref: o.ref,
    label: o.label,
  })),
);

const hasLightChainOptions = computed(() => lightChainDropdownOptions.value.length > 0);

// Snapshot writer for the LC picker. The user picks a ref; we find the
// matching entry in the model's options array to extract the chain
// string (workflow needs it for chain-domain tagging of output columns,
// and sections() uses it for κ / λ qualifier labels). Both fields go
// into `data` in one gesture — same hairpin-free shape as the heavy
// input snapshot.
function onPickLightChain(ref: PlRef | undefined) {
  if (ref === undefined) {
    app.model.data.lightChainPick = undefined;
    app.model.data.lightChainRef = undefined;
    return;
  }
  const match = app.model.outputs.lightChainOptions?.find((o) => plRefsEqual(o.ref, ref));
  app.model.data.lightChainRef = ref;
  app.model.data.lightChainPick = match?.chain;
}

// Live PlAlert mirror (R9). Mirrors args lambda's checks.
const alertMessage = computed<string | undefined>(() => {
  const live = app.model.outputs.upstreamFacts;
  if (live === undefined) return undefined;
  if (app.model.data.inputRef === undefined) return undefined;

  const tcr = live.chains.filter((c) => c.startsWith("TCR"));
  if (tcr.length > 0) {
    return `Selected input contains TCR chains (${tcr.join(", ")}); this block is BCR-only.`;
  }
  if (live.chains.length === 0) {
    return "Selected input has no detectable chain — re-select an input.";
  }
  if (live.chains.length > 1) {
    return `Selected input spans multiple chains (${live.chains.join(", ")}).`;
  }
  const chain = live.chains[0];
  if (chain !== "IGHeavy") {
    return `Selected input chain is "${chain}", not IGHeavy. Pick the IG Heavy anchor.`;
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
    label="Input dataset"
    clearable
    required
    @update:model-value="onPickInput"
  >
    <template #tooltip>
      MiXCR clonotyping output to analyze. Must contain B-cell receptor heavy-chain data — light
      chains and T-cell receptors are not supported as the primary input.
    </template>
  </PlDropdownRef>

  <PlAlert v-if="alertMessage" type="warn">
    {{ alertMessage }}
  </PlAlert>

  <PlNumberField
    :model-value="app.model.data.threshold"
    label="Heavy-chain threshold"
    :min="0"
    :max="1"
    :step="0.0001"
    required
    @update:model-value="(v) => (app.model.data.threshold = v)"
  >
    <template #tooltip>
      Frequency cutoff for the convergence call. Clonotypes with a neighbour-frequency above this
      value are flagged as convergent. Default 0.000961 corresponds to ≈5% false-discovery rate on
      human IgH (Abbate et al. 2024). Recalibrate visually on the histogram for non-human or non-IgH
      data.
    </template>
  </PlNumberField>

  <!-- Light-chain picker (R18). Hidden when the upstream has no LC
       anchors. Opt-in by design — empty by default, user picks
       explicitly to enable LC processing. -->
  <PlDropdownRef
    v-if="hasLightChainOptions"
    :model-value="app.model.data.lightChainRef"
    :options="lightChainDropdownOptions"
    label="Light chain"
    clearable
    @update:model-value="onPickLightChain"
  >
    <template #tooltip>
      Optional. Pick a light-chain anchor from the same clonotyping run to run a parallel
      convergence pipeline on its clonotypes. Light-chain results are exploratory — the threshold is
      uncalibrated for light chains and should be re-tuned on the histogram.
    </template>
  </PlDropdownRef>

  <PlNumberField
    v-if="app.model.data.lightChainPick !== undefined"
    :model-value="app.model.data.thresholdL"
    label="Light-chain threshold"
    :min="0"
    :max="1"
    :step="0.0001"
    @update:model-value="(v) => (app.model.data.thresholdL = v)"
  >
    <template #tooltip>
      Frequency cutoff for the light-chain convergence call. Defaults to the heavy-chain value.
      Light-chain diversity is lower (no D segment, shorter CDR3), so the heavy-calibrated value
      often over-flags — recalibrate visually on the light-chain histogram.
    </template>
  </PlNumberField>

  <PlAccordionSection label="Advanced settings">
    <PlNumberField
      :model-value="app.model.data.nMin"
      label="Minimum unique CDR3 per sample"
      :min="1"
      :step="1"
      @update:model-value="(v) => (app.model.data.nMin = v)"
    >
      <template #tooltip>
        Samples with fewer than this many unique nucleotide CDR3 sequences are skipped. Below this
        floor, neighbour-density estimates become unreliable. Default 100.
      </template>
    </PlNumberField>
  </PlAccordionSection>
</template>

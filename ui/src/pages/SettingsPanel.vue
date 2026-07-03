<script setup lang="ts">
import type { PlRef } from "@platforma-sdk/model";
import {
  PlAccordionSection,
  PlAlert,
  PlCheckbox,
  PlDropdown,
  PlDropdownRef,
  PlNumberField,
  PlTooltip,
} from "@platforma-sdk/ui-vue";
import canonicalize from "canonicalize";
import { computed, watch } from "vue";
import { useApp } from "../app";

const app = useApp();

const HEAVY_CHAIN = "IGHeavy";
const LIGHT_CHAINS = new Set(["IGLight", "IGKappa", "IGLambda"]);
const SC_AXIS = "pl7.app/vdj/scClonotypeKey";

const factsFor = (ref: PlRef | undefined) => {
  if (!ref) return undefined;
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  if (key === undefined) return undefined;
  const facts = app.model.outputs.factsByRef?.[key];
  // Return a copy so the persisted snapshot in `data` doesn't alias the
  // reactive outputs object.
  return facts ? { ...facts, chains: [...facts.chains] } : undefined;
};

// Look up the dataset label as shown in the dropdown for the picked ref.
// Snapshotted at pick time so the page subtitle (R55) renders without
// having to re-resolve options later.
const labelFor = (ref: PlRef | undefined): string | undefined => {
  if (!ref) return undefined;
  return app.model.outputs.datasetOptions?.find(
    (o) => o.ref.blockId === ref.blockId && o.ref.name === ref.name,
  )?.label;
};

// Snapshot pattern (R8, R24): when the user picks the input dataset,
// write `datasetRef`, `datasetFacts`, AND `datasetLabel` in the same
// user-gesture handler. Reads from the model's factsByRef map +
// datasetOptions. Picking a new dataset also clears the LC opt-in
// because it depends on the pick (R66).
function onPickDataset(ref: PlRef | undefined) {
  if (ref === undefined) {
    app.model.data.datasetRef = undefined;
    app.model.data.datasetFacts = undefined;
    app.model.data.datasetLabel = undefined;
    app.model.data.processLightChain = false;
    return;
  }
  // Re-selecting the current dataset is a no-op: the snapshot was written when
  // it was first picked from a valid (gated) option, so there's nothing to
  // update — and doing nothing can't downgrade a good snapshot to the partial
  // facts that pool repopulation transiently exposes.
  const currentRef = app.model.data.datasetRef;
  const sameRef =
    currentRef !== undefined && currentRef.blockId === ref.blockId && currentRef.name === ref.name;
  if (sameRef) return;

  app.model.data.datasetRef = ref;
  app.model.data.datasetFacts = factsFor(ref);
  app.model.data.datasetLabel = labelFor(ref);
  app.model.data.processLightChain = false;
  // NOTE: exportSampleId is NOT cleared here — a different dataset from the
  // same clonotyping run can share the exact sample list, and we want to
  // keep the pick in that case. Validity is reconciled reactively below
  // (watch on exportSampleOptions), which only drops the pick when the new
  // list genuinely lacks it.
}

// Which chain(s) are detected on the dataset pick. The dataset itself
// may carry both chains (SC IG anchor) but per R66 we only AUTO-process
// the heavy slot — LC opt-in goes through the SC checkbox. Bulk mode
// processes whichever single chain the picked anchor carries.
const datasetChains = computed(() => app.model.data.datasetFacts?.chains ?? []);
const datasetHasHeavy = computed(() => datasetChains.value.includes(HEAVY_CHAIN));
const datasetHasLight = computed(() => datasetChains.value.some((c) => LIGHT_CHAINS.has(c)));
const datasetIsBulkLight = computed(() => datasetHasLight.value && !datasetHasHeavy.value);
const datasetIsSC = computed(() => app.model.data.datasetFacts?.clonotypeKeyAxisName === SC_AXIS);

// Heavy slot active iff the dataset has heavy.
const heavyActive = computed(() => datasetHasHeavy.value);

// LC slot active iff:
//   - the dataset is bulk-light (LC IS the dataset), OR
//   - SC dataset + LC checkbox ticked (processLightChain).
const lightActive = computed(
  () => datasetIsBulkLight.value || app.model.data.processLightChain === true,
);

// LC opt-in only exists in SC paired mode (R66). Bulk mode is
// strictly single-chain — no checkbox, no secondary dropdown.
const showLightCheckbox = computed(
  () => datasetIsSC.value && datasetHasHeavy.value && datasetHasLight.value,
);
const lightChecked = computed(() => app.model.data.processLightChain === true);

// Checkbox toggle: the light chain is a column-domain sibling on the same
// anchor as the dataset pick, so this is just an opt-in flag.
function onToggleLightCheckbox(v: boolean) {
  app.model.data.processLightChain = v;
}

// Live PlAlert mirror (R9). Mirrors args lambda's checks.
const alertMessage = computed<string | undefined>(() => {
  const facts = app.model.data.datasetFacts;
  if (app.model.data.datasetRef === undefined || facts === undefined) return undefined;

  const tcr = facts.chains.filter((c) => c.startsWith("TCR"));
  if (tcr.length > 0) {
    return `Selected input contains TCR chains (${tcr.join(", ")}); this block is BCR-only.`;
  }
  if (facts.chains.length === 0) {
    return "Selected input has no detectable BCR chain — re-select an input.";
  }
  if (!datasetHasHeavy.value && !datasetHasLight.value) {
    return `Selected input chains "${facts.chains.join(", ")}" are not BCR — re-select an input.`;
  }
  return undefined;
});

// Reconcile the exported-sample pick against the current dataset's sample
// list. Drop it ONLY when the loaded list genuinely lacks it (e.g. the new
// dataset has different samples); keep it when the new dataset shares the
// same samples (heavy vs light from one clonotyping run). The readiness
// guard is essential: while the list is undefined/empty (startup, or the
// gap right after a dataset change before options recompute) we do nothing,
// so a valid pick is never wiped during the not-ready window.
//
// This is NOT a hairpin: exportSampleOptions depends on the dataset
// (datasetRef), not on exportSampleId, so this write cannot feed back into the
// watched output; and the write is deterministic, so it's idempotent across
// clients.
watch(
  () => app.model.outputs.exportSampleOptions,
  (options) => {
    if (!options || options.length === 0) return; // not ready — leave the pick alone
    const current = app.model.data.exportSampleId;
    if (current === undefined) return;
    if (!options.some((o) => o.value === current)) {
      app.model.data.exportSampleId = undefined;
    }
  },
  { immediate: true },
);
</script>

<template>
  <PlDropdownRef
    :options="app.model.outputs.datasetOptions"
    :model-value="app.model.data.datasetRef"
    label="Input dataset"
    clearable
    required
    @update:model-value="onPickDataset"
  >
    <template #tooltip>
      VDJ output to analyze. Accepts any B-cell receptor — bulk Heavy/Light, or single-cell. T-cell
      receptors aren't supported. For in-vivo (immunised) repertoires only.
    </template>
  </PlDropdownRef>

  <PlAlert v-if="alertMessage" type="warn">
    {{ alertMessage }}
  </PlAlert>

  <!-- Heavy-chain threshold. Visible iff a heavy chain is present on
       the dataset (bulk-heavy or SC IG). -->
  <PlNumberField
    v-if="heavyActive"
    v-model="app.model.data.thresholdH"
    label="Heavy-chain threshold"
    :min="0"
    :max="1"
    :step="0.0001"
    required
  >
    <template #tooltip>
      Frequency cutoff for the convergence call. Clonotypes with a neighbour-frequency above this
      value are flagged as convergent. Default 0.000961 corresponds to ≈5% false-discovery rate on
      human IgH (Abbate et al. 2024). Recalibrate visually on the histogram for non-human or non-IgH
      data.
    </template>
  </PlNumberField>

  <!-- LC opt-in (R66). SC IG dataset → checkbox (same anchor carries
       both chains as column-domain siblings). Bulk mode → no LC control
       (single-chain: a bulk-light dataset is processed as the primary chain). -->
  <PlCheckbox
    v-if="showLightCheckbox"
    :model-value="lightChecked"
    @update:model-value="onToggleLightCheckbox"
  >
    Process light chain
    <PlTooltip class="info" position="top">
      <template #tooltip>
        The selected single-cell input contains both heavy and light chains. Check to also analyze
        the light chain — emits a parallel light-chain hit column and histogram. Unchecked = heavy
        only.
      </template>
    </PlTooltip>
  </PlCheckbox>

  <!-- Light-chain threshold. Visible iff LC processing is active:
       bulk-light dataset, or SC + LC checkbox ticked. No default
       value (R17). -->
  <PlNumberField
    v-if="lightActive"
    v-model="app.model.data.thresholdL"
    label="Light-chain threshold"
    :min="0"
    :max="1"
    :step="0.0001"
    placeholder="e.g. 0.000961 (heavy reference — recalibrate for LC)"
    required
  >
    <template #tooltip>
      Frequency cutoff for the light-chain convergence call. No default — light-chain diversity is
      lower (no D segment, shorter CDR3) and has no published FDR calibration, so the
      heavy-calibrated value (0.000961) typically over-flags. Set explicitly and recalibrate
      visually on the light-chain histogram.
    </template>
  </PlNumberField>

  <!-- Single-sample export (R69, R75). Picks which sample's convergence
       columns get exported (collapsed to a clonotype-only axis) for
       Antibody Lead Selection. No default — unset exports nothing. Options
       come from the upstream dataset's samples, so the picker is usable
       before the first run. -->
  <PlAlert v-if="app.model.data.datasetRef" type="info">
    Convergence is exported for one sample at a time, on a per-clonotype basis. Pick a sample to
    make its convergence available to downstream blocks.
  </PlAlert>
  <PlDropdown
    v-if="app.model.data.datasetRef"
    v-model="app.model.data.exportSampleId"
    :options="app.model.outputs.exportSampleOptions ?? []"
    label="Sample to export"
    clearable
  />

  <PlAccordionSection label="Advanced settings">
    <!-- Cluster filter (R58). Off by default. When on, an additional
         fastStarClusterFiltered column marks hits that ALSO lie in a
         Hamming/Levenshtein-1 cluster of size >= clusterMin
         (paper's binder definition). -->
    <PlCheckbox v-model="app.model.data.applyClusterFilter">
      Apply cluster filter
      <PlTooltip class="info" position="top">
        <template #tooltip>
          Adds a stricter hit definition alongside the threshold-only one: clonotypes whose CDR3
          sits in a cluster of similar CDR3s (one-edit distance) of at least the size below.
          Mitigates sequencing-error noise and matches Abbate et al. 2024's headline "binder"
          definition. Off by default — the threshold-only hit column stays as the primary signal.
        </template>
      </PlTooltip>
    </PlCheckbox>

    <PlNumberField
      v-model="app.model.data.clusterMin"
      label="Minimum cluster size"
      :min="1"
      :step="1"
      :disabled="!app.model.data.applyClusterFilter"
      required
    >
      <template #tooltip>
        Minimum size of the CDR3 cluster (one-edit distance) required for a hit to survive the
        binder filter. Paper default is 10.
      </template>
    </PlNumberField>

    <PlNumberField
      v-model="app.model.data.nMin"
      label="Minimum unique CDR3 per sample"
      :min="1"
      :step="1"
    >
      <template #tooltip>
        Samples with fewer than this many unique nucleotide CDR3 sequences are skipped. Below this
        floor, neighbour-density estimates become unreliable. Default 100.
      </template>
    </PlNumberField>
  </PlAccordionSection>
</template>

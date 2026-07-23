<script setup lang="ts">
import type { PlRef } from "@platforma-sdk/model";
import { PFrameImpl } from "@platforma-sdk/model";
import {
  PlAccordionSection,
  PlAlert,
  PlCheckbox,
  PlDropdown,
  PlDropdownMulti,
  PlDropdownRef,
  PlNumberField,
  PlTooltip,
  useWatchFetch,
} from "@platforma-sdk/ui-vue";
import {
  isHeavy,
  isLight,
  SC_AXIS,
} from "@platforma-open/milaboratories.clonotype-convergence.model";
import canonicalize from "canonicalize";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

// ---- Clonotype-only aggregation controls (A-0011) ------------------------
// Sample-metadata columns offered for the expected-sample filter and the
// independence grouping (both sampleId-keyed `pl7.app/metadata`).
const metadataColumnOptions = computed(
  () => app.model.outputs.metadataOptions?.map((o) => ({ value: o.ref, label: o.label })) ?? [],
);
// Unique values of the picked expected-filter column, for the value multiselect
// (fetched from the PFrame the model exposes — same idiom as DCA's numerators).
const expectedValueOptions = useWatchFetch(
  () => app.model.outputs.expectedValueSource,
  async (pframeHandle) => {
    if (!pframeHandle) return [];
    const pframe = new PFrameImpl(pframeHandle);
    const list = await pframe.listColumns();
    const id = list?.[0]?.columnId;
    if (!id) return [];
    const response = await pframe.getUniqueValues({ columnId: id, filters: [], limit: 1_000_000 });
    return [...(response?.values.data ?? [])].map((v) => ({ value: String(v), label: String(v) }));
  },
);
// Computed get/set wrappers so the v-models stay well-typed over the optional
// BlockData fields (undefined on legacy data → the default), mirroring the
// customBlockLabel pattern. `k` and replicability are NOT exposed (A-0011): the
// grouping dropdown alone turns on k=2; the only score knob is the weight `w`.
const expectedValuesModel = computed<string[]>({
  get: () => app.model.data.expectedValues ?? [],
  set: (v) => {
    app.model.data.expectedValues = v;
  },
});
const scoreWeightModel = computed<number>({
  get: () => app.model.data.scoreWeight ?? 0.5,
  set: (v) => {
    app.model.data.scoreWeight = v;
  },
});

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
// Snapshotted at pick time so the page subtitle renders without having
// to re-resolve options later.
const labelFor = (ref: PlRef | undefined): string | undefined => {
  if (!ref) return undefined;
  return app.model.outputs.datasetOptions?.find(
    (o) => o.ref.blockId === ref.blockId && o.ref.name === ref.name,
  )?.label;
};

// Snapshot pattern: when the user picks the input dataset, write
// `datasetRef`, `datasetFacts`, AND `datasetLabel` in the same
// user-gesture handler. Reads from the model's factsByRef map +
// datasetOptions. Picking a new dataset also clears the LC opt-in
// because it depends on the pick.
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
}

// Which chain(s) are detected on the dataset pick. The dataset itself
// may carry both chains (SC IG anchor) but we only AUTO-process the
// heavy slot — LC opt-in goes through the SC checkbox. Bulk mode
// processes whichever single chain the picked anchor carries.
const datasetChains = computed(() => app.model.data.datasetFacts?.chains ?? []);
const datasetHasHeavy = computed(() => datasetChains.value.some(isHeavy));
const datasetHasLight = computed(() => datasetChains.value.some(isLight));
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

// LC opt-in only exists in SC paired mode. Bulk mode is strictly
// single-chain — no checkbox, no secondary dropdown.
const showLightCheckbox = computed(
  () => datasetIsSC.value && datasetHasHeavy.value && datasetHasLight.value,
);
const lightChecked = computed(() => app.model.data.processLightChain === true);

// Checkbox toggle: the light chain is a column-domain sibling on the same
// anchor as the dataset pick, so this is just an opt-in flag.
function onToggleLightCheckbox(v: boolean) {
  app.model.data.processLightChain = v;
}

// Method per chain comes from the dataset-facts snapshot (data.datasetFacts),
// captured at pick time — same source the args lambda gates on. A chain runs
// in the fast-STAR fallback when its Pgen is absent (`hasPgen* === false`); the
// per-chain fast-STAR threshold is shown (and required) only then. `undefined`
// facts (no pick yet) show nothing.
const heavyFast = computed(
  () => heavyActive.value && app.model.data.datasetFacts?.hasPgenHeavy === false,
);
const lightFast = computed(
  () => lightActive.value && app.model.data.datasetFacts?.hasPgenLight === false,
);
// SC light opt-in is disabled only when enabling it would MIX methods — heavy
// and light differ in Pgen availability (A-0003/A-0010). When both chains agree
// (both full, or both fast) the light chain is selectable; in the both-fast
// case the light threshold below becomes required.
const lightCheckboxDisabled = computed(() => {
  const f = app.model.data.datasetFacts;
  return f !== undefined && f.hasPgenHeavy !== f.hasPgenLight;
});
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

  <!-- fast-STAR fallback notice. Shown when a processed chain has no Pgen
       available, so the block uses the threshold-based call instead of the
       FDR-controlled full-STAR (A-0010). -->
  <PlAlert v-if="heavyFast || lightFast" type="warn" icon>
    <template #title>Pgen not available — fast-STAR fallback</template>
    Generation Probability wasn't found for this input, so the block falls back to the
    threshold-based fast-STAR call — <b>not</b> FDR-controlled. Run the Generation Probability block
    on this dataset (an OLGA-supported species) and re-pick it here to enable full-STAR. The
    per-chain thresholds below are the fast-STAR parameters.
  </PlAlert>

  <!-- Heavy-chain fast-STAR threshold. Only shown in fallback (no Pgen) —
       full-STAR uses the FDR target (alpha) in Advanced instead. -->
  <PlNumberField
    v-if="heavyFast"
    v-model="app.model.data.thresholdH"
    label="Heavy-chain threshold (fast-STAR)"
    :min="0"
    :max="1"
    :step="0.0001"
    required
  >
    <template #tooltip>
      fast-STAR frequency cutoff (used only when Pgen is unavailable). Clonotypes with a
      neighbour-frequency above this value are flagged as convergent. Default 0.000961 corresponds
      to ≈5% false-discovery rate on human IgH (Abbate et al. 2024). Recalibrate visually on the
      histogram for non-human or non-IgH data.
    </template>
  </PlNumberField>

  <!-- LC opt-in. SC IG dataset → checkbox (same anchor carries both
       chains as column-domain siblings). Bulk mode → no LC control
       (single-chain: a bulk-light dataset is processed as the primary chain). -->
  <PlCheckbox
    v-if="showLightCheckbox"
    :model-value="lightChecked"
    :disabled="lightCheckboxDisabled"
    @update:model-value="onToggleLightCheckbox"
  >
    Process light chain
    <PlTooltip class="info" position="top">
      <template #tooltip>
        The selected single-cell input contains both heavy and light chains. Check to also analyze
        the light chain — emits a parallel light-chain hit column and histogram. Unchecked = heavy
        only.
        <template v-if="lightCheckboxDisabled">
          <br /><br />Disabled: the heavy and light chains differ in Pgen availability, so one would
          run full-STAR and the other fast-STAR. Mixing the two methods in a single run isn't
          supported — run Generation Probability for both chains (or neither) to process the light
          chain.
        </template>
      </template>
    </PlTooltip>
  </PlCheckbox>

  <!-- Light-chain fast-STAR threshold. Only shown when the light chain is
       processed AND in fallback (no Pgen). No default — required in fallback. -->
  <PlNumberField
    v-if="lightFast"
    v-model="app.model.data.thresholdL"
    label="Light-chain threshold (fast-STAR)"
    :min="0"
    :max="1"
    :step="0.0001"
    placeholder="e.g. 0.000961 (heavy reference — recalibrate for LC)"
    required
  >
    <template #tooltip>
      fast-STAR frequency cutoff for the light chain (used only when Pgen is unavailable).
      Light-chain diversity is lower (no D segment, shorter CDR3) and has no published FDR
      calibration, so the heavy-calibrated value (0.000961) typically over-flags. Recalibrate
      visually on the light-chain histogram.
    </template>
  </PlNumberField>

  <!-- Clonotype-only aggregation (A-0011): how the per-sample signal collapses
       to the one exported value per clonotype the in-vivo score / lead selection
       consume. Always visible. Defaults (both empty) = every sample an
       independent, eligible unit, convergent in >= 1. -->
  <PlDropdown
    v-model="app.model.data.expectedFilterRef"
    :options="metadataColumnOptions"
    label="Timepoint"
    clearable
  >
    <template #tooltip>
      Restrict the exported aggregate to biologically-expected samples (e.g. post-immunisation
      timepoints). Pick a metadata column, then the values that count as expected. The block's own
      per-sample table still shows every sample. Empty = use all samples.
    </template>
  </PlDropdown>
  <PlDropdownMulti
    v-if="app.model.data.expectedFilterRef"
    v-model="expectedValuesModel"
    :options="expectedValueOptions.value ?? []"
    label="Expected values"
  />
  <PlDropdown
    v-model="app.model.data.groupingRef"
    :options="metadataColumnOptions"
    label="Biological replicate"
    clearable
  >
    <template #tooltip>
      Mark which samples are independent biological replicates (e.g. a donor / animal column), so
      correlated same-replicate samples collapse before the across-replicate aggregation. Setting it
      turns on cross-replicate reproducibility — a clone must be a hit in ≥ 2 replicates — and adds
      the reproducibility term to the convergence score. Empty = every sample independent
      (convergent in ≥ 1).
    </template>
  </PlDropdown>

  <PlAccordionSection label="Advanced settings">
    <!-- full-STAR FDR target. The primary full-STAR knob; kept in Advanced
         so full-STAR runs on the default without prompting for a statistical
         parameter (A-0015). Ignored in the fast-STAR fallback. -->
    <PlNumberField
      v-model="app.model.data.alpha"
      label="FDR target (alpha)"
      :min="0"
      :max="1"
      :step="0.001"
    >
      <template #tooltip>
        full-STAR false-discovery-rate target for the Benjamini–Hochberg call across each sample's
        clonotypes. Lower = stricter (fewer, higher-confidence hits). STAR default 0.005. Applies
        only when Pgen is available (full-STAR); ignored in the fast-STAR fallback.
      </template>
    </PlNumberField>

    <!-- starScore strength↔reproducibility weight w (A-0011). The one score
         knob; default 0.5. Only takes effect on the support term when an
         independence grouping is set. -->
    <PlNumberField
      v-model="scoreWeightModel"
      label="Score weight: strength ↔ reproducibility (w)"
      :min="0"
      :max="1"
      :step="0.05"
    >
      <template #tooltip>
        Balances the exported convergence score between peak strength and cross-donor
        reproducibility:
        <b>starScore = w · pct(peak) + (1 − w) · pct(support)</b>. w = 1 ranks on convergence
        strength alone; w = 0 on donor recurrence alone; 0.5 (default) blends them. The support term
        is only active when an independence grouping is set.
      </template>
    </PlNumberField>

    <!-- Cluster filter. Off by default. When on, an additional
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

<script setup lang="ts">
import type { PlRef } from "@platforma-sdk/model";
import { PFrameImpl } from "@platforma-sdk/model";
import {
  PlAccordion,
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
  pgenHeavyAvailable,
  pgenLightAvailable,
  SC_AXIS,
} from "@platforma-open/milaboratories.clonotype-convergence.model";
import canonicalize from "canonicalize";
import { computed, ref } from "vue";
import { useApp } from "../app";

const app = useApp();

// "Convergence context" section open by default so its controls stay visible
// (grouped, not hidden). Local UI state, not persisted.
const convergenceContextOpen = ref(true);

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
// Computed get/set wrapper so the v-model stays well-typed over the optional
// BlockData field (undefined on legacy data → the default), mirroring the
// customBlockLabel pattern. The aggregation exposes NO other knob (A-0011):
// the score is a named method with no weight and no percentile, and the FDR
// target `alpha` in Advanced settings is the only statistical parameter.
const expectedValuesModel = computed<string[]>({
  get: () => app.model.data.expectedValues ?? [],
  set: (v) => {
    app.model.data.expectedValues = v;
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

// full-STAR availability hint (A-0010/A-0015). Shown here, beside the input
// pick that determines it, rather than as a banner over the results: a chain
// without Generation Probability is a complete fast-STAR result, not a
// failure, so the note is an invitation rather than a warning. Availability is
// ref presence (the model helpers), never the stored flag. Names the chain
// only when the other one does have it, so the hint stays one short line.
const fullStarHint = computed<string | undefined>(() => {
  const facts = app.model.data.datasetFacts;
  if (!facts) return undefined;
  const heavyMissing = heavyActive.value && !pgenHeavyAvailable(facts);
  const lightMissing = lightActive.value && !pgenLightAvailable(facts);
  if (!heavyMissing && !lightMissing) return undefined;
  const onlyOne =
    heavyActive.value && lightActive.value && heavyMissing !== lightMissing
      ? heavyMissing
        ? " for the heavy chain"
        : " for the light chain"
      : "";
  return `Add a Generation Probability block${onlyOne} to also get full-STAR — an FDR-controlled convergence call.`;
});

// Parallel modes (A-0010): fast-STAR runs on every processed chain, so its
// per-chain nb_freq threshold is always shown when that chain is active
// (heavyActive / lightActive). full-STAR is added automatically wherever the
// chain has Generation Probability — no method toggle, no disable-light.
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

  <PlAlert v-if="fullStarHint" type="info">
    {{ fullStarHint }}
  </PlAlert>

  <!-- Heavy-chain fast-STAR threshold. fast-STAR runs on every chain, so this
       is always shown when heavy is processed. -->
  <PlNumberField
    v-if="heavyActive"
    v-model="app.model.data.thresholdH"
    label="Heavy-chain threshold (fast-STAR)"
    :min="0"
    :max="1"
    :step="0.0001"
    required
  >
    <template #tooltip>
      fast-STAR neighbour-frequency cutoff: clonotypes above it are flagged as a fast-STAR hit.
      fast-STAR runs on every chain. Default 0.000961 ≈ 5% false-discovery rate on human IgH (Abbate
      et al. 2024); recalibrate visually on the per-sample distribution for non-human or non-IgH
      data.
    </template>
  </PlNumberField>

  <!-- LC opt-in. SC IG dataset → checkbox (same anchor carries both
       chains as column-domain siblings). Bulk mode → no LC control
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
        the light chain — emits a parallel light-chain family. full-STAR is added automatically
        wherever the light chain has Generation Probability. Unchecked = heavy only.
      </template>
    </PlTooltip>
  </PlCheckbox>

  <!-- Light-chain fast-STAR threshold. Shown when the light chain is processed
       (fast-STAR runs on every chain). No default — required. -->
  <PlNumberField
    v-if="lightActive"
    v-model="app.model.data.thresholdL"
    label="Light-chain threshold (fast-STAR)"
    :min="0"
    :max="1"
    :step="0.0001"
    placeholder="e.g. 0.000961 (heavy reference — recalibrate for LC)"
    required
  >
    <template #tooltip>
      fast-STAR neighbour-frequency cutoff for the light chain. Light-chain diversity is lower (no D
      segment, shorter CDR3) and has no published FDR calibration, so the heavy-calibrated value
      (0.000961) typically over-flags. Recalibrate visually on the per-sample distribution.
    </template>
  </PlNumberField>

  <!-- Convergence context (A-0011): the biological metadata that shapes the
       clonotype-only aggregated export — an expected-convergence sample filter
       and an independence (replicate) grouping. Grouped in a section, default
       open. Defaults (all empty) = every sample an independent, eligible
       unit. -->
  <!-- Convergence context: collapsible section, OPEN by default. Standalone
       PlAccordionSection can't default-open (an injected accordion manager
       drives it), so wrap in PlAccordion multiple → the section's v-model
       controls its open state. -->
  <PlAccordion :multiple="true">
    <PlAccordionSection v-model="convergenceContextOpen" label="Convergence context">
      <!-- Expected-convergence filter: pick the metadata column whose values
           pinpoint where convergence is expected, then which of its values to
           keep. Restricts the EXPORTED aggregate; the per-sample table keeps
           all samples. Empty = use all samples. The column + its values are a
           tight pair (small gap) so it's obvious the values belong to the
           column above; Replicate keeps normal spacing. -->
      <div :class="$style.filterPair">
        <PlDropdown
          v-model="app.model.data.expectedFilterRef"
          :options="metadataColumnOptions"
          label="Convergence expected at"
          clearable
        >
          <template #tooltip>
            Restrict the exported aggregate to samples where convergence is biologically expected.
            Pick the metadata column (e.g. timepoint) whose values mark where convergence is
            expected; choose the values below. This also sets the cohort the
            <b>reproducibility</b> column is measured against. The block's own per-sample table
            keeps every sample regardless. Empty = use all samples.
          </template>
        </PlDropdown>
        <!-- Always visible; inactive until a column is picked (no column → no
             values to choose). -->
        <PlDropdownMulti
          v-model="expectedValuesModel"
          :options="expectedValueOptions.value ?? []"
          label="Selected values"
          :disabled="!app.model.data.expectedFilterRef"
        />
      </div>
      <PlDropdown
        v-model="app.model.data.groupingRef"
        :options="metadataColumnOptions"
        label="Replicate"
        clearable
      >
        <template #tooltip>
          Which samples come from the same independent unit (e.g. a donor or animal column). Samples
          sharing a value collapse together first, so replicates and timepoints of one donor count
          as <b>one</b> piece of evidence rather than several. The units left after that collapse
          are what the exported score combines across, and they are also the cohort the
          <b>reproducibility</b> column is measured over. Empty = every sample treated as an
          independent unit.
        </template>
      </PlDropdown>
    </PlAccordionSection>
  </PlAccordion>

  <PlAccordionSection label="Advanced settings">
    <!-- full-STAR FDR target. The ONLY statistical knob (A-0011/A-0015); kept
         in Advanced so full-STAR runs on the default without prompting for a
         statistical parameter. Drives both BH passes — within each sample and
         across clonotypes after aggregation. Unused on a chain without Pgen
         (fast-STAR is a threshold call, not FDR-controlled). -->
    <PlNumberField
      v-model="app.model.data.alpha"
      label="FDR target (alpha)"
      :min="0"
      :max="1"
      :step="0.001"
    >
      <template #tooltip>
        full-STAR false-discovery-rate target for the Benjamini–Hochberg call — applied twice: once
        across each sample's clonotypes, and once across clonotypes in the exported aggregate. Lower
        = stricter (fewer, higher-confidence hits). STAR default 0.005. Applies only where
        Generation Probability is available (full-STAR); fast-STAR uses its neighbour-frequency
        threshold instead.
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

<style module>
/* Tight column→values pair: the "Selected values" multiselect sits close under
   "Convergence expected at" so it reads as that column's values, while the
   surrounding controls (Replicate, etc.) keep normal spacing. */
.filterPair {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>

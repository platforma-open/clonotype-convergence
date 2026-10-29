<script setup lang="ts">
import type { DatasetSelection, PlRef } from "@platforma-sdk/model";
import { createDatasetSelection, createPrimaryRef, PFrameImpl } from "@platforma-sdk/model";
import {
  PlAccordion,
  PlAccordionSection,
  PlAlert,
  PlCheckbox,
  PlDatasetSelector,
  PlDropdown,
  PlDropdownMulti,
  PlNumberField,
  PlTooltip,
  useWatchFetch,
} from "@platforma-sdk/ui-vue";
import {
  DEFAULT_ISOTYPES,
  isHeavy,
  isLight,
  pgenHeavyAvailable,
  pgenLightAvailable,
  SC_AXIS,
} from "@platforma-open/milaboratories.clonotype-convergence.model";
import { computed, ref, watch } from "vue";
import { useApp } from "../app";
import { factsFor, labelFor } from "../datasetSnapshot";

const app = useApp();

// "Convergence context" section open by default so its controls stay visible
// (grouped, not hidden). Local UI state, not persisted.
const convergenceContextOpen = ref(true);

// ---- Clonotype-only aggregation controls ------------------------
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
// customBlockLabel pattern. The aggregation exposes NO other knob:
// the score is a named method with no weight and no percentile, and the FDR
// target `alpha` in Advanced settings is the only statistical parameter.
const expectedValuesModel = computed<string[]>({
  get: () => app.model.data.expectedValues ?? [],
  set: (v) => {
    app.model.data.expectedValues = v;
  },
});

// ---- Isotype filter ---------------------------------------------
// Offered only when the dataset carries a heavy-chain isotype; the args lambda
// applies the same gate, so a hidden control never filters anything.
const showIsotypeFilter = computed(() => app.model.data.datasetFacts?.hasIsotype === true);
// The isotypes this dataset actually has, from its isotype column.
const isotypeOptions = useWatchFetch(
  () => app.model.outputs.isotypeValueSource,
  async (pframeHandle) => {
    if (!pframeHandle) return undefined;
    const pframe = new PFrameImpl(pframeHandle);
    const list = await pframe.listColumns();
    const id = list?.[0]?.columnId;
    if (!id) return undefined;
    const response = await pframe.getUniqueValues({ columnId: id, filters: [], limit: 1_000 });
    // Unknown isotypes aren't offered: the filter always keeps them (blank, or
    // MiXCR's "cant_distinguish" — see pack-input).
    return [...(response?.values.data ?? [])]
      .filter((v) => v !== null && v !== "" && v !== "cant_distinguish")
      .map((v) => String(v))
      .sort()
      .map((v) => ({ value: v, label: v }));
  },
);
const isotypeValuesModel = computed<string[]>({
  get: () => app.model.data.isotypeValues ?? [],
  set: (v) => {
    app.model.data.isotypeValues = v;
  },
});
// Strict boolean for the checkbox's v-model over the optional field.
const perIsotypeModel = computed<boolean>({
  get: () => app.model.data.perIsotype === true,
  set: (v) => {
    app.model.data.perIsotype = v;
  },
});
// Narrow the selection to the isotypes the dataset has. A value it lacks
// matches nothing, so dropping it changes no result — except when nothing is
// left: the selection then empties, which keeps every clonotype. Without that,
// a dataset whose isotypes are spelled differently (e.g. "IGHG1" from an
// import), or one with no known isotype at all, would lose every clonotype to
// the IgM/IgG default — unknown isotypes are dropped by a non-empty selection.
// An unresolved list (undefined: still loading) is not acted on.
watch(
  () => isotypeOptions.value,
  (options) => {
    if (!options) return;
    const available = new Set(options.map((o) => o.value));
    const current = app.model.data.isotypeValues ?? [];
    const kept = current.filter((v) => available.has(v));
    if (kept.length !== current.length) app.model.data.isotypeValues = kept;
  },
  { immediate: true },
);

// Snapshot pattern: when the user picks the input dataset, write
// `datasetRef`, `datasetFacts`, AND `datasetLabel` in the same
// user-gesture handler. Reads from the model's factsByRef map +
// datasetOptions. Picking a new dataset also clears the LC opt-in and
// resets the isotype selection, because both depend on the pick.
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
  app.model.data.datasetFacts = factsFor(app.model, ref);
  app.model.data.datasetLabel = labelFor(app.model, ref, app.model.data.filterRef);
  app.model.data.processLightChain = false;
  // A new dataset starts from the default isotypes; the watcher above narrows
  // them to what it has.
  app.model.data.isotypeValues = [...DEFAULT_ISOTYPES];
}

// The selector picks a dataset, or a dataset narrowed by one of its subset columns.
// Stored as two refs so blocks saved before filters existed keep their `datasetRef`.
// The filter is written first: `onPickDataset` returns early when only the filter
// changed (same dataset), and the snapshot it guards doesn't depend on the filter.
const datasetSelection = computed<DatasetSelection | undefined>({
  get: () => {
    const { datasetRef, filterRef } = app.model.data;
    if (datasetRef === undefined) return undefined;
    return createDatasetSelection(createPrimaryRef(datasetRef, filterRef));
  },
  set: (selection) => {
    app.model.data.filterRef = selection?.primary.filter;
    onPickDataset(selection?.primary.column);
    // A filter-only change leaves the dataset (and so onPickDataset) untouched, but it
    // does change the subtitle label.
    if (selection !== undefined) {
      app.model.data.datasetLabel = labelFor(
        app.model,
        selection.primary.column,
        selection.primary.filter,
      );
    }
  },
});

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

// full-STAR availability hint. Shown here, beside the input
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

// Parallel modes: fast-STAR runs on every processed chain, so its
// per-chain nb_freq threshold is always shown when that chain is active
// (heavyActive / lightActive). full-STAR is added automatically wherever the
// chain has Generation Probability — no method toggle, no disable-light.
</script>

<template>
  <PlDatasetSelector
    v-model="datasetSelection"
    :options="app.model.outputs.datasetOptions"
    label="Input dataset"
    clearable
    required
  >
    <template #tooltip>
      VDJ output to analyze. Accepts any B-cell receptor — bulk Heavy/Light, or single-cell. T-cell
      receptors aren't supported. For in-vivo (immunised) repertoires only. Pick one of its subsets
      (for example a label from Repertoire Labeling) to analyze only the clonotypes in that subset.
    </template>
  </PlDatasetSelector>

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

  <!-- Convergence context: the biological metadata that shapes the analysis —
       which isotypes are kept, and for the clonotype-only aggregated export an
       expected-convergence sample filter and an independence (replicate)
       grouping. Grouped in a section, default
       open. Defaults (all empty) = every sample an independent, eligible
       unit. -->
  <!-- Convergence context: collapsible section, OPEN by default. Standalone
       PlAccordionSection can't default-open (an injected accordion manager
       drives it), so wrap in PlAccordion multiple → the section's v-model
       controls its open state. -->
  <PlAccordion :multiple="true">
    <PlAccordionSection v-model="convergenceContextOpen" label="Convergence context">
      <!-- Isotype filter: which heavy-chain isotypes stay in the analysis.
           Shown only when the dataset has an isotype column on the heavy
           chain. -->
      <PlDropdownMulti
        v-if="showIsotypeFilter"
        v-model="isotypeValuesModel"
        :options="isotypeOptions.value ?? []"
        label="Keep isotypes"
        placeholder="All isotypes"
      >
        <template #tooltip>
          Heavy-chain isotypes to analyze. Other clonotypes, including those of unknown isotype, are
          excluded before neighbour counting. Single-cell: applies to both chains. Empty = all
          clonotypes.
        </template>
      </PlDropdownMulti>
      <!-- Per-isotype scores: the kept isotypes are the compartments, so it
           needs a selection. -->
      <PlCheckbox
        v-if="showIsotypeFilter"
        v-model="perIsotypeModel"
        :disabled="isotypeValuesModel.length === 0"
      >
        Also score against each kept isotype
        <PlTooltip class="info" position="top">
          <template #tooltip>
            Adds a score and a hit per kept isotype, with neighbours counted among that isotype's
            CDR3s only. The clone's own nucleotide CDR3 is not counted.
          </template>
        </PlTooltip>
      </PlCheckbox>
      <!-- Expected-convergence filter: pick the metadata column whose values
           pinpoint where convergence is expected, then which of its values to
           keep. Restricts the EXPORTED aggregate; the per-sample table keeps
           all samples. Empty = use all samples. The column + its values render
           as ONE joined control (groupPosition top/bottom, no gap) the way the
           table filters do, so the values obviously belong to the column above;
           Replicate keeps normal spacing. -->
      <div :class="$style.filterPair">
        <PlDropdown
          v-model="app.model.data.expectedFilterRef"
          :options="metadataColumnOptions"
          label="Convergence expected at"
          group-position="top"
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
          group-position="bottom"
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
    <!-- full-STAR FDR target. The ONLY statistical knob; kept
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
          Adds a stricter hit definition alongside each existing one: clonotypes whose CDR3 sits in
          a cluster of similar CDR3s (one-edit distance) of at least the size below. Applied to
          every hit call the block emits, so fast-STAR and full-STAR each get their own
          cluster-filtered column. Mitigates sequencing-error noise and matches Abbate et al. 2024's
          headline "binder" definition. Off by default — the unfiltered hit columns stay as the
          primary signal.
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
/* Joined column→values pair: the value multiselect is flush under
   "Convergence expected at" so the two read as one control, while the
   surrounding controls (Replicate, etc.) keep normal spacing. */
.filterPair {
  display: flex;
  flex-direction: column;
}

/* Pull the lower control up onto the one above so their adjoining 1px
   borders overlap into a single line — groupPosition squares the corners
   but leaves both borders drawn. */
.filterPair > *:not(:first-child) {
  margin-top: -1px;
}
</style>

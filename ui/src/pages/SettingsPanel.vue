<script setup lang="ts">
import type { PlRef } from "@platforma-sdk/model";
import {
  PlAccordionSection,
  PlAlert,
  PlCheckbox,
  PlDropdownRef,
  PlNumberField,
  PlTooltip,
} from "@platforma-sdk/ui-vue";
import canonicalize from "canonicalize";
import { computed } from "vue";
import { useApp } from "../app";

const app = useApp();

const HEAVY_CHAIN = "IGHeavy";
const LIGHT_CHAINS = new Set(["IGLight", "IGKappa", "IGLambda"]);
const SC_AXIS = "pl7.app/vdj/scClonotypeKey";

const factsFor = (ref: PlRef | undefined) => {
  if (!ref) return undefined;
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  return key === undefined ? undefined : app.model.outputs.factsByRef?.[key];
};

// Look up the dataset label as shown in the dropdown for the picked ref.
// Snapshotted at pick time so the page subtitle (R55) renders without
// having to re-resolve options later.
const labelFor = (ref: PlRef | undefined): string | undefined => {
  if (!ref) return undefined;
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  return app.model.outputs.datasetOptions?.find(
    (o) => canonicalize(o.ref as unknown as Record<string, unknown>) === key,
  )?.label;
};

// Snapshot pattern (R8, R24): when the user picks the main input,
// write `mainRef`, `mainRefFacts`, AND `mainRefLabel` in the same
// user-gesture handler. Reads from the model's factsByRef map +
// datasetOptions, both keyed by canonical PlRef. Picking a new main
// also clears the LC pick because the LC options depend on the main
// pick (R66).
function onPickMain(ref: PlRef | undefined) {
  if (ref === undefined) {
    app.model.data.mainRef = undefined;
    app.model.data.mainRefFacts = undefined;
    app.model.data.mainRefLabel = undefined;
    app.model.data.lightRef = undefined;
    app.model.data.lightRefFacts = undefined;
    return;
  }
  app.model.data.mainRef = ref;
  app.model.data.mainRefFacts = factsFor(ref);
  app.model.data.mainRefLabel = labelFor(ref);
  app.model.data.lightRef = undefined;
  app.model.data.lightRefFacts = undefined;
}

// Which chain(s) are detected on the main pick. The main itself may
// carry both chains (SC IG anchor) but per R66 we only AUTO-process
// the heavy slot from the main pick — LC opt-in goes through the SC
// checkbox. Bulk mode processes whichever single chain the picked
// anchor carries — no secondary LC dropdown.
const mainChains = computed(() => app.model.data.mainRefFacts?.chains ?? []);
const mainHasHeavy = computed(() => mainChains.value.includes(HEAVY_CHAIN));
const mainHasLight = computed(() => mainChains.value.some((c) => LIGHT_CHAINS.has(c)));
const mainIsBulkLight = computed(() => mainHasLight.value && !mainHasHeavy.value);
const mainIsSC = computed(() => app.model.data.mainRefFacts?.axisName === SC_AXIS);

// Heavy slot active iff the main pick has heavy.
const heavyActive = computed(() => mainHasHeavy.value);

// LC slot active iff:
//   - main is bulk-light (LC IS the main), OR
//   - SC main + LC checkbox ticked (lightRef set).
const lightActive = computed(() => mainIsBulkLight.value || app.model.data.lightRef !== undefined);

// LC opt-in only exists in SC paired mode (R66). Bulk mode is
// strictly single-chain — no checkbox, no secondary dropdown.
const showLightCheckbox = computed(
  () => mainIsSC.value && mainHasHeavy.value && mainHasLight.value,
);
const lightChecked = computed(() => app.model.data.lightRef !== undefined);

// Checkbox toggle: writes lightRef ← mainRef (same anchor; LC siblings
// hang off it as column-domain children). Cleared on uncheck.
function onToggleLightCheckbox(v: boolean) {
  if (v && app.model.data.mainRef) {
    app.model.data.lightRef = app.model.data.mainRef;
    app.model.data.lightRefFacts = app.model.data.mainRefFacts;
  } else {
    app.model.data.lightRef = undefined;
    app.model.data.lightRefFacts = undefined;
  }
}

// Live PlAlert mirror (R9). Mirrors args lambda's checks.
const alertMessage = computed<string | undefined>(() => {
  const facts = app.model.data.mainRefFacts;
  if (app.model.data.mainRef === undefined || facts === undefined) return undefined;

  const tcr = facts.chains.filter((c) => c.startsWith("TCR"));
  if (tcr.length > 0) {
    return `Selected input contains TCR chains (${tcr.join(", ")}); this block is BCR-only.`;
  }
  if (facts.chains.length === 0) {
    return "Selected input has no detectable BCR chain — re-select an input.";
  }
  if (!mainHasHeavy.value && !mainHasLight.value) {
    return `Selected input chains "${facts.chains.join(", ")}" are not BCR — re-select an input.`;
  }
  if (!facts.hasAaCDR3 || !facts.hasNtCDR3) {
    return "Selected input is missing required CDR3 columns — re-select an input.";
  }
  if (!facts.hasAbundance) {
    return "Selected input has no abundance column — re-select an input.";
  }
  return undefined;
});
</script>

<template>
  <PlDropdownRef
    :options="app.model.outputs.datasetOptions"
    :model-value="app.model.data.mainRef"
    label="Input dataset"
    clearable
    required
    @update:model-value="onPickMain"
  >
    <template #tooltip>
      MiXCR clonotyping output to analyze. Accepts any B-cell receptor anchor — heavy bulk, light
      bulk, or single-cell paired (heavy + light on one anchor). T-cell receptors aren't supported.
    </template>
  </PlDropdownRef>

  <PlAlert v-if="alertMessage" type="warn">
    {{ alertMessage }}
  </PlAlert>

  <!-- Heavy-chain threshold. Visible iff a heavy chain is present on
       the main pick (bulk-heavy OR SC IG main). -->
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

  <!-- LC opt-in (R66). SC IG main → checkbox (same anchor carries
       both chains as column-domain siblings). Bulk-heavy main →
       dropdown of LC anchors. Bulk-light main → neither (LC is main). -->
  <PlCheckbox
    v-if="showLightCheckbox"
    :model-value="lightChecked"
    @update:model-value="onToggleLightCheckbox"
  >
    Process light chain
    <PlTooltip class="info" position="top">
      <template #tooltip>
        The selected single-cell anchor carries light-chain siblings on the same per-cell axis
        (column-domain key <code>scClonotypeChain = "B"</code>). Check this to also run the
        convergence pipeline on those LC siblings — emits a parallel light-chain hit column and
        histogram. Unchecked = heavy only.
      </template>
    </PlTooltip>
  </PlCheckbox>

  <!-- Light-chain threshold. Visible iff LC processing is active:
       bulk-light MAIN, or SC main + LC checkbox ticked. No default
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

  <PlAccordionSection label="Advanced settings">
    <!-- Cluster filter (R58). Off by default. When on, an additional
         fastStarClusterFiltered column marks hits that ALSO lie in a
         Hamming/Levenshtein-1 cluster of size >= clusterMin
         (paper's binder definition). -->
    <PlCheckbox v-model="app.model.data.applyClusterFilter">
      Apply cluster filter
      <PlTooltip class="info" position="top">
        <template #tooltip>
          Adds a stricter hit definition alongside the threshold-only one: clonotypes that also lie
          in a Hamming/Levenshtein-1 cluster of size at least the threshold below. Mitigates
          sequencing-error noise and matches Abbate et al. 2024's headline "binder" definition. Off
          by default — the threshold-only hit column stays as the primary signal.
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
        Minimum number of similar clonotypes (Hamming/Levenshtein-1 cluster) required for a hit to
        survive the binder filter. Paper default is 10.
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

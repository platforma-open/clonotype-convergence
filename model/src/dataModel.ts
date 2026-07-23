import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import { DEFAULT_ALPHA, DEFAULT_NMIN } from "./chains";
import type { BlockData, BlockDataV1 } from "./types";

export const blockDataModel = new DataModelBuilder()
  .from<BlockDataV1>("v1")
  // v2 — collapse the v1 dual-ref (mainRef/lightRef) into a single dataset
  // snapshot plus a `processLightChain` boolean, and map `axisName` →
  // `clonotypeKeyAxisName`.
  .migrate<BlockData>(
    "v2",
    ({ mainRef, mainRefFacts, mainRefLabel, lightRef, lightRefFacts, ...rest }) => {
      void lightRefFacts; // dropped — equal to mainRefFacts
      return {
        ...rest,
        datasetRef: mainRef,
        datasetLabel: mainRefLabel,
        processLightChain: lightRef !== undefined,
        datasetFacts: mainRefFacts && {
          chains: mainRefFacts.chains,
          hasAaCDR3: mainRefFacts.hasAaCDR3,
          hasNtCDR3: mainRefFacts.hasNtCDR3,
          hasAbundance: mainRefFacts.hasAbundance,
          clonotypeKeyAxisName: mainRefFacts.axisName,
          // v1 predates Pgen — no full-STAR facts. Left false; the user
          // re-picks the dataset to capture current Pgen availability.
          hasPgenHeavy: false,
          hasPgenLight: false,
        },
      };
    },
  )
  .init(() => ({
    settingsOpen: true,
    logsOpen: false,
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
    // Empty string = user hasn't customised the label; the derived
    // chain/threshold subtitle shows as a placeholder in the page header.
    customBlockLabel: "",
    // Heavy-chain fast-STAR threshold default 0.000961 (≈5% FDR target on
    // Abbate et al. 2024 human IgH calibration). Used only in the fast-STAR
    // fallback (full-STAR uses `alpha`); the UI shows it only when the heavy
    // chain has no Pgen.
    // thresholdL deliberately has NO default; the user must enter it
    // explicitly (in fast mode) so an inappropriate light-chain value isn't
    // shipped silently — the args lambda gates the run until it's set.
    thresholdH: 0.000961,
    nMin: DEFAULT_NMIN,
    // full-STAR FDR target (Benjamini–Hochberg). STAR default 0.005.
    alpha: DEFAULT_ALPHA,
    // Cluster filter — off by default. Paper default 10 for cluster_min
    // when the toggle is on.
    applyClusterFilter: false,
    clusterMin: 10,
    // Clonotype-only aggregation (A-0011). Defaults = the default path: no
    // metadata refs, every sample an independent eligible unit, k = 1. The
    // expected-values multiselect + the starScore weight are initialised so
    // their v-model bindings are well-typed. `w` default 0.5 (50/50).
    expectedValues: [],
    scoreWeight: 0.5,
    // Heavy-chain histogram graph state. Initial settings:
    // bins template, log Y axis (long-tail signal — most clones have
    // small Nb_freq, a few have very large).
    graphStateHistogramHeavy: {
      title: "Convergence score",
      template: "bins",
      currentTab: null,
      layersSettings: {
        bins: { fillColor: "#99e099" },
      },
      axesSettings: {
        axisY: {
          axisLabelsAngle: 90,
          scale: "log",
        },
        other: { binsCount: 30 },
      },
    },
    // Light-chain histogram graph state. Same shape as heavy;
    // different fill colour to disambiguate at a glance.
    graphStateHistogramLight: {
      title: "Convergence score",
      template: "bins",
      currentTab: null,
      layersSettings: {
        bins: { fillColor: "#99c4e0" },
      },
      axesSettings: {
        axisY: {
          axisLabelsAngle: 90,
          scale: "log",
        },
        other: { binsCount: 30 },
      },
    },
  }));

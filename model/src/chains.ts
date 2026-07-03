import type { BlockData } from "./types";

/**
 * Chain / axis / anchor constants and small helpers shared between the
 * model's outputs and the workflow-facing args lambda. Kept separate
 * from `index.ts` so the model builder stays readable.
 */

// Datasets the dropdown offers — anchors on the clonotype-keyed axes
// (R10). Bulk uses pl7.app/vdj/clonotypeKey; single-cell uses
// pl7.app/vdj/scClonotypeKey.
export const inputAnchorSpecs = [
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/clonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/scClonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
];

export const SC_AXIS = "pl7.app/vdj/scClonotypeKey";

// Default sample-size floor (R12). Shared by the data model's init() and
// the trace-label builder, which omits nMin from the label when it's
// left at this default.
export const DEFAULT_NMIN = 100;

// MiXCR chain DOMAIN values (R28). Heavy = "IGHeavy"; light family
// includes IGLight (κ + λ combined) plus IGKappa / IGLambda when MiXCR
// surfaces them separately. TCR domain values are TCRAlpha/TCRBeta/
// TCRGamma/TCRDelta — filtered out at R10.
const HEAVY_CHAIN = "IGHeavy";
const LIGHT_CHAINS = new Set(["IGLight", "IGKappa", "IGLambda"]);

// SC anchors put receptor (not chain) in the axis domain. "IG" = BCR;
// TCRAB / TCRGD = TCR families. Chain identity in SC lives on the
// COLUMN domain via `scClonotypeChain` ("A" = heavy, "B" = light) plus
// `scClonotypeChain/index` (primary / secondary allele).
export const SC_BCR_RECEPTOR = "IG";
export const SC_CHAIN_FROM_LETTER: Record<string, string> = { A: HEAVY_CHAIN, B: "IGLight" };
export const SC_LETTER_FROM_CHAIN: Record<string, string> = {
  IGHeavy: "A",
  IGLight: "B",
  IGKappa: "B",
  IGLambda: "B",
};

export function isHeavy(chain: string | undefined): boolean {
  return chain === HEAVY_CHAIN;
}
export function isLight(chain: string | undefined): boolean {
  return !!chain && LIGHT_CHAINS.has(chain);
}

// Settings portion of the block's identity label — threshold(s), nMin
// (only when non-default), and the cluster filter. This is the single
// source of truth shared by the page subtitle and the column trace, so
// the two stay consistent:
//   - column trace uses it as-is (the dataset is already in the column
//     domain — no need to repeat it);
//   - the subtitle prefixes the dataset label (see formatSubtitle).
// deriveDistinctLabels in downstream blocks (graph-maker, data-mapping)
// renders the trace label only when needed to disambiguate, so a single
// block's labels are unchanged; without these settings two blocks on the
// same dataset with different settings collapse to identical labels.
export function getDefaultBlockLabel(data: BlockData): string {
  const parts: string[] = [];

  const facts = data.datasetFacts;
  if (facts) {
    const isSC = facts.clonotypeKeyAxisName === SC_AXIS;
    const primaryThreshold = facts.chains.some(isHeavy) ? data.thresholdH : data.thresholdL;
    if (primaryThreshold !== undefined) {
      let thr = `thr ${primaryThreshold}`;
      if (isSC && data.processLightChain && data.thresholdL !== undefined) {
        thr += ` / L thr ${data.thresholdL}`;
      }
      parts.push(thr);
    }
  }

  // Only surface nMin when it deviates from the default — keeps the
  // common case uncluttered.
  if (data.nMin !== undefined && data.nMin !== DEFAULT_NMIN) {
    parts.push(`nMin ${data.nMin}`);
  }
  if (data.applyClusterFilter && data.clusterMin !== undefined) {
    parts.push(`cluster ≥ ${data.clusterMin}`);
  }

  return parts.join(", ");
}

// R55 subtitle — dataset label + settings (getDefaultBlockLabel), kept
// consistent with the column trace label which uses the same settings
// string. Unlike most multi-setting blocks we DO keep the dataset here:
// two convergence blocks on different inputs (e.g. different chains) is a
// likely setup, and the dataset label is what disambiguates them in the
// page header. Dataset label is snapshotted at pick time. Empty until an
// input is picked. A " - " separates the dataset from the settings so the
// commas inside the settings part don't blur into the dataset name.
export function formatSubtitle(data: BlockData): string | undefined {
  if (!data.datasetFacts || !data.datasetLabel) return undefined;
  const settings = getDefaultBlockLabel(data);
  return settings.length > 0 ? `${data.datasetLabel} - ${settings}` : data.datasetLabel;
}

import type { BlockData, UpstreamFacts } from "./types";

/**
 * Chain / axis / anchor constants and small helpers shared between the
 * model's outputs and the workflow-facing args lambda. Kept separate
 * from `index.ts` so the model builder stays readable.
 */

// Datasets the dropdown offers — anchors on the clonotype-keyed axes.
// Bulk uses pl7.app/vdj/clonotypeKey; single-cell uses
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

// Raw per-clonotype generation probability from the Generation Probability
// block — full-STAR's input, and what decides per chain whether full-STAR is
// added at all. fast-STAR is unaffected: it runs either way.
export const PGEN_NAME = "pl7.app/vdj/generationProbability";

// Default full-STAR FDR target (STAR's default). Shared by the data
// model's init() and the args lambda's default when the field is absent.
export const DEFAULT_ALPHA = 0.005;

// Default sample-size floor. Shared by the data model's init() and
// the trace-label builder, which omits nMin from the label when it's
// left at this default.
export const DEFAULT_NMIN = 100;

/** Heavy-chain fast-STAR threshold default (~5% FDR on human IgH, Abbate et
 *  al. 2024). The LIGHT chain deliberately has no default — any light
 *  threshold the user enters is by definition a custom setting. */
export const DEFAULT_THRESHOLD_H = 0.000961;

// MiXCR chain DOMAIN values. Heavy = "IGHeavy"; light family
// includes IGLight (κ + λ combined) plus IGKappa / IGLambda when MiXCR
// surfaces them separately. TCR domain values are TCRAlpha/TCRBeta/
// TCRGamma/TCRDelta — filtered out of the dropdown.
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
// Pgen availability is DEFINED by ref presence — `discoverUpstreamFacts` sets
// `hasPgen* = (pgenRef* !== undefined)` so args and the workflow can never
// disagree. Read it through these helpers rather than the stored boolean: a
// snapshot written by an older build can carry `hasPgen: false` next to a live
// ref (undefined values are dropped crossing the model → UI boundary, so a
// merge could update the flag without clearing the ref), and trusting the flag
// there silently downgrades the run to fast-STAR while a usable Pgen ref sits
// in the block's own data.
export function pgenHeavyAvailable(facts: UpstreamFacts | undefined): boolean {
  return facts?.pgenRefHeavy !== undefined;
}
export function pgenLightAvailable(facts: UpstreamFacts | undefined): boolean {
  return facts?.pgenRefLight !== undefined;
}

export function getDefaultBlockLabel(data: BlockData): string {
  const parts: string[] = [];

  const facts = data.datasetFacts;
  if (facts) {
    const isSC = facts.clonotypeKeyAxisName === SC_AXIS;
    const primaryIsHeavy = facts.chains.some(isHeavy);
    // The threshold labels a chain ONLY where full-STAR is absent (no Pgen);
    // full-STAR uses alpha and hides the threshold, so surfacing it would
    // misrepresent the run. Mixed methods are designed out (args throws), so
    // the primary chain's Pgen availability decides for both.
    const runsFallback = primaryIsHeavy ? !pgenHeavyAvailable(facts) : !pgenLightAvailable(facts);
    if (runsFallback) {
      // Only CUSTOM settings belong in the label — the same rule nMin and alpha
      // below follow. The heavy threshold has a default, so it is surfaced only
      // when the user changed it; the light chain has no default, so any value
      // there is custom by construction.
      const primaryThreshold = primaryIsHeavy ? data.thresholdH : data.thresholdL;
      const primaryIsCustom = primaryIsHeavy
        ? primaryThreshold !== undefined && primaryThreshold !== DEFAULT_THRESHOLD_H
        : primaryThreshold !== undefined;
      const lightIsCustom = isSC && data.processLightChain && data.thresholdL !== undefined;
      if (primaryIsCustom || lightIsCustom) {
        const bits: string[] = [];
        if (primaryIsCustom) bits.push(`thr ${primaryThreshold}`);
        if (lightIsCustom) bits.push(`L thr ${data.thresholdL}`);
        parts.push(bits.join(" / "));
      }
    } else if (data.alpha !== undefined && data.alpha !== DEFAULT_ALPHA) {
      // full-STAR: disambiguate blocks by their FDR target when non-default.
      parts.push(`alpha ${data.alpha}`);
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

// Subtitle — dataset label + settings (getDefaultBlockLabel), kept
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

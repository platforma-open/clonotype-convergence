import type {
  InferOutputsType,
  PColumnSpec,
  PFrameHandle,
  PlRef,
  RenderCtxBase,
} from "@platforma-sdk/model";
import {
  BlockModelV3,
  createPFrameForGraphs,
  createPlDataTableSheet,
  createPlDataTableV3,
  getUniquePartitionKeys,
} from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import { blockDataModel } from "./dataModel";
import type { BlockArgs, BlockData, UpstreamFacts } from "./types";

export type { BlockArgs, BlockData, UpstreamFacts };
export { blockDataModel } from "./dataModel";

// Datasets the dropdown offers — anchors on the clonotype-keyed axes
// (R10). Bulk uses pl7.app/vdj/clonotypeKey; single-cell uses
// pl7.app/vdj/scClonotypeKey.
const inputAnchorSpecs = [
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/clonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/scClonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
];

const SC_AXIS = "pl7.app/vdj/scClonotypeKey";

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
const SC_BCR_RECEPTOR = "IG";
const SC_CHAIN_FROM_LETTER: Record<string, string> = { A: HEAVY_CHAIN, B: "IGLight" };
const SC_LETTER_FROM_CHAIN: Record<string, string> = {
  IGHeavy: "A",
  IGLight: "B",
  IGKappa: "B",
  IGLambda: "B",
};

function isHeavy(chain: string | undefined): boolean {
  return chain === HEAVY_CHAIN;
}
function isLight(chain: string | undefined): boolean {
  return !!chain && LIGHT_CHAINS.has(chain);
}

// Friendly chain name for user-facing strings (R64 — no raw IGHeavy /
// IGLight in copy). Subtitle (R55), section labels, etc.
function friendlyChain(chain: string): string {
  if (chain === "IGHeavy") return "Heavy";
  if (chain === "IGLight") return "Light";
  if (chain === "IGKappa") return "Light (κ)";
  if (chain === "IGLambda") return "Light (λ)";
  return chain;
}

// R55 subtitle — derived from the populated chain slots in `data`.
// Empty when not enough is picked to be meaningful (the page header
// renders the placeholder, project list falls back to "").
function formatSubtitle(data: BlockData): string | undefined {
  const parts: string[] = [];
  const chains = data.mainRefFacts?.chains ?? [];
  const heavy = chains.find(isHeavy);
  const light = chains.find(isLight);
  if (heavy && data.thresholdH !== undefined) {
    parts.push(`${friendlyChain(heavy)} ${data.thresholdH}`);
  }
  if (light && data.thresholdL !== undefined) {
    parts.push(`${friendlyChain(light)} ${data.thresholdL}`);
  }
  return parts.length === 0 ? undefined : parts.join(" / ");
}

/**
 * Walk the siblings of `ref` on its shared axes and aggregate facts:
 * which chains appear, whether the required CDR3 + abundance siblings
 * are present, and the axis name (drives R61 mode detection).
 */
function discoverUpstreamFacts<A, U>(
  ctx: RenderCtxBase<A, U>,
  ref: PlRef,
): UpstreamFacts | undefined {
  const refSpec = ctx.resultPool.getPColumnSpecByRef(ref);
  if (!refSpec) return undefined;
  // Axis name of the second axis = clonotype-key axis. Drives R61
  // mode detection and the BULK-vs-SC handling below.
  const axisName = refSpec.axesSpec[1]?.name ?? "";
  const isSC = axisName === SC_AXIS;

  // MiXCR partitions outputs across two axis frames: per-(sample,
  // clonotype) and per-clonotype. The anchored selector matches axes
  // exactly, so we need both queries.
  const perSampleClonotype =
    ctx.resultPool.getAnchoredPColumns({ main: ref }, [
      {
        axes: [
          { anchor: "main", idx: 0 },
          { anchor: "main", idx: 1 },
        ],
      },
    ]) ?? [];
  const perClonotype =
    ctx.resultPool.getAnchoredPColumns({ main: ref }, [{ axes: [{ anchor: "main", idx: 1 }] }]) ??
    [];

  const chains = new Set<string>();
  // Track presence flags PER CHAIN — necessary in SC mode where the
  // SAME anchor carries siblings for both heavy and light chains and
  // we need to know whether each chain has its full CDR3 + abundance
  // sibling set. In bulk mode there's only one chain so this
  // collapses to the old behaviour.
  const hasAaCDR3: Record<string, boolean> = {};
  const hasNtCDR3: Record<string, boolean> = {};
  const hasAbundance: Record<string, boolean> = {};

  for (const col of [...perSampleClonotype, ...perClonotype]) {
    const spec = col.spec;

    // Chain identity differs between bulk and SC outputs from MiXCR:
    //   - Bulk: chain in axis domain or column domain via `pl7.app/vdj/chain`.
    //   - SC: chain in column domain via `pl7.app/vdj/scClonotypeChain`
    //         (letter "A"/"B"; map to IGHeavy/IGLight). Skip secondary
    //         alleles — only the primary allele counts as a valid input
    //         (matches sequence-properties' deviation A).
    let chain: string | undefined;
    if (isSC) {
      const idx = spec.domain?.["pl7.app/vdj/scClonotypeChain/index"];
      if (idx !== undefined && idx !== "primary") continue;
      const letter = spec.domain?.["pl7.app/vdj/scClonotypeChain"];
      if (letter) chain = SC_CHAIN_FROM_LETTER[letter];
    } else {
      chain =
        spec.domain?.["pl7.app/vdj/chain"] ??
        spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"] ??
        spec.axesSpec[0]?.domain?.["pl7.app/vdj/chain"];
    }
    if (chain) chains.add(chain);

    // Track per-chain sibling presence. `chain ?? ""` buckets
    // chain-agnostic siblings under "" — useful for bulk where the
    // chain is implicit on the anchor itself.
    const key = chain ?? "";
    if (spec.name === "pl7.app/vdj/sequence" && spec.domain?.["pl7.app/vdj/feature"] === "CDR3") {
      const alphabet = spec.domain["pl7.app/alphabet"];
      if (alphabet === "aminoacid") hasAaCDR3[key] = true;
      if (alphabet === "nucleotide") hasNtCDR3[key] = true;
    }
    if (spec.annotations?.["pl7.app/isAbundance"] === "true") {
      hasAbundance[key] = true;
    }
  }

  // Bulk mode: presence flags hang under the lone detected chain (or
  // "" for chain-agnostic). Reduce to scalars by ORing across keys.
  const anyTrue = (m: Record<string, boolean>) => Object.values(m).some(Boolean);

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3: anyTrue(hasAaCDR3),
    hasNtCDR3: anyTrue(hasNtCDR3),
    hasAbundance: anyTrue(hasAbundance),
    axisName,
  };
}

// R66 — chainL is only populated when the user makes it explicit:
//  - bulk-light MAIN pick (only chain → chainL ← main), or
//  - any other main + secondary lightRef set (chainL ← lightRef).
// SC main never auto-populates chainL even though both chains hang
// off the same anchor — the user opts in via the LC picker.

export const platforma = BlockModelV3.create(blockDataModel)
  .args((data): BlockArgs => {
    if (!data.mainRef || !data.mainRefFacts) {
      throw new Error("Select a dataset");
    }
    const mainFacts = data.mainRefFacts;
    const mainIsSC = mainFacts.axisName === SC_AXIS;

    // ---- R5 staleness checks on the main pick ---------------------
    const tcr = mainFacts.chains.filter((c) => c.startsWith("TCR"));
    if (tcr.length > 0) {
      throw new Error(
        `Selected input contains TCR chains (${tcr.join(", ")}); this block is BCR-only.`,
      );
    }
    if (!mainFacts.hasAaCDR3) throw new Error("Selected input is missing the aa CDR3 column.");
    if (!mainFacts.hasNtCDR3) throw new Error("Selected input is missing the nt CDR3 column.");
    if (!mainFacts.hasAbundance) throw new Error("Selected input is missing an abundance column.");

    // ---- Heavy slot (always from main when main has heavy) --------
    let chainH: PlRef | undefined;
    let chainHName: string | undefined;
    const mainHeavy = mainFacts.chains.find(isHeavy);
    if (mainHeavy) {
      chainH = data.mainRef;
      chainHName = mainHeavy;
    }

    // ---- Light slot (explicit per R66) ----------------------------
    // Two sources, mutually exclusive:
    //  1. main is bulk-light  → chainL ← main pick;
    //  2. secondary lightRef set → chainL ← lightRef (bulk-heavy main
    //     + bulk-light secondary, OR SC main + SC secondary opt-in).
    let chainL: PlRef | undefined;
    let chainLName: string | undefined;
    let chainLFacts: UpstreamFacts | undefined;
    const mainLight = mainFacts.chains.find(isLight);
    if (mainLight && !mainHeavy) {
      chainL = data.mainRef;
      chainLName = mainLight;
      chainLFacts = mainFacts;
    } else if (data.lightRef && data.lightRefFacts) {
      const lightName = data.lightRefFacts.chains.find(isLight);
      if (lightName) {
        chainL = data.lightRef;
        chainLName = lightName;
        chainLFacts = data.lightRefFacts;
      }
    }
    if (chainL && chainLFacts) {
      if (!chainLFacts.hasAaCDR3)
        throw new Error("Light-chain input is missing the aa CDR3 column.");
      if (!chainLFacts.hasNtCDR3)
        throw new Error("Light-chain input is missing the nt CDR3 column.");
      if (!chainLFacts.hasAbundance) throw new Error("Light-chain input has no abundance column.");
    }

    if (!chainH && !chainL) {
      throw new Error(
        `Selected dataset chains are ${mainFacts.chains.join(", ") || "unknown"} — expected a BCR anchor.`,
      );
    }

    // ---- Thresholds (R16 / R17 / R19) -----------------------------
    if (chainH && data.thresholdH === undefined) {
      throw new Error("Heavy-chain threshold is required");
    }
    if (chainL && data.thresholdL === undefined) {
      throw new Error("Light-chain threshold is required");
    }

    // ---- nMin (R12) -----------------------------------------------
    if (data.nMin === undefined) {
      throw new Error("Minimum unique CDR3 per sample is required");
    }

    // ---- Cluster filter (R58) -------------------------------------
    const applyClusterFilter = data.applyClusterFilter ?? false;
    let clusterMin: number | undefined;
    if (applyClusterFilter) {
      if (data.clusterMin === undefined) {
        throw new Error("Minimum cluster size is required");
      }
      clusterMin = data.clusterMin;
    }

    // SC mode → workflow needs the scClonotypeChain LETTER ("A"/"B")
    // to filter sibling columns to the right chain. Determined per
    // slot: the H slot's SC mode follows the main pick; the L slot's
    // SC mode follows the LC source's mode (which may be the same SC
    // anchor as main, or — hypothetically — a separate SC anchor).
    const lightIsSC = chainLFacts?.axisName === SC_AXIS;

    const args: BlockArgs = {
      nMin: data.nMin,
      applyClusterFilter,
    };
    if (chainH) {
      args.chainH = chainH;
      args.chainHName = chainHName;
      args.thresholdH = data.thresholdH;
      if (mainIsSC) args.chainHScLetter = SC_LETTER_FROM_CHAIN[chainHName!];
    }
    if (chainL) {
      args.chainL = chainL;
      args.chainLName = chainLName;
      args.thresholdL = data.thresholdL;
      if (lightIsSC) args.chainLScLetter = SC_LETTER_FROM_CHAIN[chainLName!];
    }
    if (clusterMin !== undefined) {
      args.clusterMin = clusterMin;
    }
    return args;
  })

  // R10 — dropdown offers any BCR-compatible anchor. Two shapes:
  //   - Bulk anchors (clonotypeKey axis): chain identity lives on the
  //     axis domain. Accept IGHeavy / IGLight / IGKappa / IGLambda;
  //     reject TCR* and anything else.
  //   - SC anchors (scClonotypeKey axis): chain lives on column
  //     domain (scClonotypeChain), so the axis has `receptor` instead.
  //     Accept receptor == "IG" (BCR — both chains hang off the same
  //     anchor); reject receptor == "TCRAB" / "TCRGD".
  // Mode (bulk vs SC) is detected post-selection by inspecting the
  // axis name on the picked spec.
  .output("datasetOptions", (ctx) => {
    const broad = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    return broad.filter((opt) => {
      const spec = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      if (!spec) return false;
      const axisName = spec.axesSpec[1]?.name;
      if (axisName === SC_AXIS) {
        const receptor = spec.axesSpec[1]?.domain?.["pl7.app/vdj/receptor"];
        return receptor === SC_BCR_RECEPTOR;
      }
      // Bulk path: chain in axis or column domain.
      const chain =
        spec.domain?.["pl7.app/vdj/chain"] ?? spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
      if (!chain) return false;
      if (chain.startsWith("TCR")) return false;
      return isHeavy(chain) || isLight(chain);
    });
  })

  // Live facts for the main pick — UI's PlAlert mirror (R9).
  .output("mainRefFacts", (ctx) => {
    if (!ctx.data.mainRef) return undefined;
    return discoverUpstreamFacts(ctx, ctx.data.mainRef);
  })

  // R52 — sample picker above the mainTable. Extracts unique sampleId
  // partition keys from the picked anchor (which IS sample-partitioned
  // by MiXCR) and wraps them as a PlDataTableSheet so the table shows
  // one sample at a time. SDK pins to a single sample — there is no
  // "all samples" entry. Cross-sample comparison is left to downstream
  // blocks operating on the long-format PColumns.
  .output("mainTableSheets", (ctx) => {
    if (!ctx.data.mainRef) return undefined;
    const anchor = ctx.resultPool.getPColumnByRef(ctx.data.mainRef);
    if (!anchor) return undefined;
    const samples = getUniquePartitionKeys(anchor.data)?.[0];
    if (!samples) return undefined;
    return [createPlDataTableSheet(ctx, anchor.spec.axesSpec[0], samples)];
  })

  // Canonical(PlRef) → UpstreamFacts for every dropdown option. The
  // UI snapshot writer reads this to write ref + facts in one tick
  // (R8, R24).
  .output("factsByRef", (ctx) => {
    const options = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    const result: Record<string, UpstreamFacts> = {};
    for (const opt of options) {
      const facts = discoverUpstreamFacts(ctx, opt.ref);
      if (facts) {
        const key = canonicalize(opt.ref as unknown as Record<string, unknown>);
        if (key !== undefined) result[key] = facts;
      }
    }
    return result;
  })

  // Per-chain log handles from Stage 1 (R45). Retentive on log handles
  // is safe (log handles tolerate retention; PFrame handles don't, R50).
  // SC paired mode emits both — UI surfaces them as two stacked panels
  // so the heavy/light per-sample prefixes (R44) stay readable.
  .retentiveOutput("runLogsHeavy", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "stage1LogsHeavy",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getLogHandle(),
  )
  .retentiveOutput("runLogsLight", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "stage1LogsLight",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getLogHandle(),
  )

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  // R55 — page-header subtitle. Returns undefined when nothing
  // meaningful to show; the page binds it as a placeholder.
  .output("subtitleText", (ctx) => formatSubtitle(ctx.data))

  // Heavy-chain p-frame for the heavy histogram. Conditional on the
  // heavy pipeline running (workflow's `convergencePf` output is only
  // emitted when args.chainH is set).
  .outputWithStatus("histogramPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "convergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPFrameForGraphs(ctx, pCols);
  })
  .output("histogramPfPcols", (ctx) => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "convergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }));
  })
  .output("heavyHitStats", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "heavyHitStats",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getDataAsJson<{ above: number; total: number; beforeCluster?: number }>(),
  )

  // Light-chain p-frame for the light histogram. Emitted when args.chainL is set.
  .outputWithStatus("lightHistogramPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "lightConvergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPFrameForGraphs(ctx, pCols);
  })
  .output("lightHistogramPfPcols", (ctx) => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "lightConvergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }));
  })
  .output("lightHitStats", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "lightHitStats",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getDataAsJson<{ above: number; total: number; beforeCluster?: number }>(),
  )

  // mainTable (R52). Anchored on the MAIN PICK's fastStar column —
  // heavy when chainH is populated (any mode that processes heavy);
  // light when only chainL is populated (bulk-light mode). For
  // heavy-SC + LC mode, mainTable is heavy and the LC clonotype table
  // lives on its own page (lightMainTable). Readiness gate avoids
  // showing partial PFrames mid-run.
  .outputWithStatus("mainTable", (ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    if (!args) return undefined;
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;

    // Pick which chain's p-frame anchors the main table. Heavy when
    // populated; else light.
    const isHeavyAnchored = args.chainH !== undefined;
    const pframeField = isHeavyAnchored ? "convergencePf" : "lightConvergencePf";
    const ref = isHeavyAnchored ? args.chainH! : args.chainL;
    if (!ref) return undefined;
    if (!ctx.resultPool.getPColumnSpecByRef(ref)) return undefined;

    const pCols = ctx.outputs
      ?.resolve({
        field: pframeField,
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    const fastStarSpec = pCols?.find(
      (c) => c.spec.name === "pl7.app/vdj/convergence/fastStar",
    )?.spec;
    if (!fastStarSpec) return undefined;

    return createPlDataTableV3(ctx, {
      columns: {
        anchors: { main: fastStarSpec },
        selector: {
          mode: "enrichment",
          // Drop per-sample-only columns (Sample label, donor, dataset,
          // metadata) — the sample sheet pins one sampleId at a time
          // (R52), so these columns would just repeat the picked value
          // on every row. `partialAxesMatch: false` excludes only
          // columns whose axes are *exactly* [sampleId] (multi-axis
          // columns that include sampleId stay).
          exclude: [
            {
              axes: [{ name: [{ type: "exact", value: "pl7.app/sampleId" }] }],
              partialAxesMatch: false,
            },
          ],
        },
      },
      tableState: ctx.data.mainTableState,
      displayOptions: {
        visibility: [
          {
            match: (spec: PColumnSpec) => {
              if (spec.name === "pl7.app/label") return false;
              if (spec.name === "pl7.app/sampleId") return false;
              if (spec.name === "pl7.app/vdj/clonotypeKey") return false;
              if (spec.name === "pl7.app/vdj/scClonotypeKey") return false;
              if (spec.name.startsWith("pl7.app/vdj/convergence/")) return false;
              return true;
            },
            visibility: "optional",
          },
        ],
      },
    });
  })

  // R51 — sections adapt to input mode. In SC paired (heavy + LC),
  // heavy and LC share the scClonotypeKey axis so both chains' columns
  // surface in the SAME main table via enrichment — no separate LC
  // table page. Modes:
  //   bulk single-chain → main table + one histogram page
  //   SC heavy-only → main table + one histogram page
  //   SC heavy + light → main table (heavy + light columns) +
  //                      heavy histogram + light histogram
  .sections((ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    const ready = ctx.data.mainRef !== undefined && args !== undefined;
    const hasHeavy = ready && args?.chainH !== undefined;
    const hasLight = ready && args?.chainL !== undefined;
    const dualChain = hasHeavy && hasLight;

    const sections: {
      type: "link";
      href: "/" | "/convergence/heavy" | "/convergence/light";
      label: string;
    }[] = [{ type: "link" as const, href: "/" as const, label: "Main" }];

    if (hasHeavy) {
      sections.push({
        type: "link" as const,
        href: "/convergence/heavy" as const,
        label: dualChain ? "Neighbour frequency (heavy)" : "Neighbour frequency",
      });
    }
    if (hasLight) {
      sections.push({
        type: "link" as const,
        href: "/convergence/light" as const,
        label: dualChain ? "Neighbour frequency (light)" : "Neighbour frequency",
      });
    }
    return sections;
  })

  .title(() => "Clonotype Convergence")
  .subtitle((ctx) => ctx.data.customBlockLabel || formatSubtitle(ctx.data) || "")

  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;

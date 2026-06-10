import type { InferOutputsType, PColumnSpec, PFrameHandle, PlRef } from "@platforma-sdk/model";
import {
  BlockModelV3,
  createPFrameForGraphs,
  createPlDataTableSheet,
  createPlDataTableV3,
  discoverTableColumnSnaphots,
  getUniquePartitionKeys,
} from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import {
  formatSubtitle,
  getDefaultBlockLabel,
  inputAnchorSpecs,
  isHeavy,
  isLight,
  SC_AXIS,
  SC_BCR_RECEPTOR,
  SC_LETTER_FROM_CHAIN,
} from "./chains";
import { blockDataModel } from "./dataModel";
import { discoverUpstreamFacts } from "./facts";
import type { BlockArgs, BlockData, UpstreamFacts } from "./types";

export type { BlockArgs, BlockData, UpstreamFacts };
export { blockDataModel } from "./dataModel";

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
      customBlockLabel: data.customBlockLabel,
      defaultBlockLabel: getDefaultBlockLabel(data),
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
    const broad = ctx.resultPool.getOptions(inputAnchorSpecs);
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

  // Source identifier for the main table's per-source state cache.
  // Derived from `activeArgs` (= the args that produced the CURRENT
  // outputs), so it only changes after a Run completes — picking a
  // new dataset before pressing Run doesn't flip the sourceId and the
  // table stays put. After Run, the new sourceId triggers a fresh
  // hidden-columns / sort state (so stale column IDs from the old
  // dataset don't haunt the new one).
  .output("mainTableSourceId", (ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    if (!args) return undefined;
    const ref = args.chainH ?? args.chainL;
    if (!ref) return undefined;
    return canonicalize(ref as unknown as Record<string, unknown>);
  })

  // R52 — sample picker above the mainTable. Extracts unique sampleId
  // partition keys from the picked anchor (which IS sample-partitioned
  // by MiXCR) and wraps them as a PlDataTableSheet so the table shows
  // one sample at a time. SDK pins to a single sample — there is no
  // "all samples" entry. Cross-sample comparison is left to downstream
  // blocks operating on the long-format PColumns.
  //
  // Gated on outputs readiness: when sheets is defined, the table
  // settings skip their pending branch and the running-state overlay
  // never appears. Returning undefined during a run keeps the table
  // in "pending" so PlAgDataTableV2 surfaces the loading overlay.
  .output("mainTableSheets", (ctx) => {
    if (!ctx.data.mainRef) return undefined;
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
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
    const options = ctx.resultPool.getOptions(inputAnchorSpecs);
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

  // Skipped-samples warning sidecar from Stage 1 (R12). Reads the
  // JSON written by compute_neighbours.py — list of sample labels
  // whose unique-nt-CDR3 count fell below nMin, plus the nMin in
  // effect at the time. UI surfaces a PlAlert above the main table
  // when either chain has skipped samples.
  .output("heavySkippedSamples", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "heavySkippedJson",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getDataAsJson<{ skipped: string[]; nMin: number }>(),
  )
  .output("lightSkippedSamples", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "lightSkippedJson",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getDataAsJson<{ skipped: string[]; nMin: number }>(),
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

    // Enrichment pulls every column sharing the anchor's axes from the
    // result pool — including convergence columns from OTHER convergence
    // blocks upstream. Discover first, then drop those in JS: an exclude
    // selector can't express "block != this one" (the spec driver's regex
    // runs in wasm/Rust, which has no negative lookahead), so we filter by
    // the block domain here. This block's id sits on the anchor's own
    // domain (pl7.app/block).
    const thisBlockId = fastStarSpec.domain?.["pl7.app/block"];
    const variants = discoverTableColumnSnaphots(ctx, {
      anchors: { main: fastStarSpec },
      selector: {
        mode: "enrichment",
        // Direct-only: no cross-domain linker hops. Without this, enrichment
        // traverses linkers from the clonotype axis into other blocks' axis
        // systems (e.g. clonotype-clustering's cluster-id axis,
        // clonotype-space's), pulling their columns AND introducing extra
        // axes into the table. maxHops:0 keeps enrichment to columns on the
        // anchor's own axes ([sampleId, clonotypeKey]) — the convergence
        // outputs plus same-axis MiXCR context (Clone ID, genes); those stay
        // optional via the visibility rules below.
        maxHops: 0,
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
    });
    if (!variants) return undefined;

    // Keep all non-convergence enrichment (Clone ID, genes, abundance, …)
    // and this block's own convergence columns; drop convergence columns
    // produced by other instances of this block.
    const ownVariants = variants.filter((v) => {
      if (!v.column.spec.name.startsWith("pl7.app/vdj/convergence/")) return true;
      if (thisBlockId === undefined) return true; // can't filter without own block id; keep all
      return v.column.spec.domain?.["pl7.app/block"] === thisBlockId;
    });

    return createPlDataTableV3(ctx, {
      columns: ownVariants,
      tableState: ctx.data.mainTableState,
      displayOptions: {
        visibility: [
          // First rule wins. Hide per-sample-only columns (axes exactly
          // [sampleId]) — chiefly the Sample label that the table's
          // automatic axis-label discovery re-adds for the array-form
          // `columns`. The sample sheet pins one sampleId at a time (R52),
          // so they'd just repeat the picked value on every row. Must come
          // before the `pl7.app/label` rule below, which would otherwise
          // force the Sample label visible. (The object-form selector used
          // to exclude these; the array form re-adds them, so we hide here.)
          {
            match: (spec: PColumnSpec) =>
              spec.axesSpec.length === 1 && spec.axesSpec[0]?.name === "pl7.app/sampleId",
            visibility: "hidden",
          },
          // Force `pl7.app/label` (clonotype-id label) to default-visible
          // — some MiXCR builds emit it with `visibility: "optional"` in
          // its own annotations, so without this rule the Clone ID column
          // shows up hidden on server runs (R52). The Sample label is
          // already caught by the rule above (first match wins).
          {
            match: (spec: PColumnSpec) => spec.name === "pl7.app/label",
            visibility: "default",
          },
          {
            match: (spec: PColumnSpec) => {
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

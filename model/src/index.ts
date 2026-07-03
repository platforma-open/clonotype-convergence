import type { InferOutputsType, PColumnSpec, PFrameHandle, PlRef } from "@platforma-sdk/model";
import {
  BlockModelV3,
  createPlDataTableSheet,
  createPlDataTableV3,
  discoverTableColumnSnaphots,
  getUniquePartitionKeys,
  parseResourceMap,
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
// Shared chain constants/helpers, so the UI imports them instead of redefining.
export { isHeavy, isLight, SC_AXIS } from "./chains";

// R66 — chainL is only populated when the user makes it explicit:
//  - bulk-light dataset (its only chain → chainL ← the dataset), or
//  - SC paired + processLightChain (chainL ← the same anchor).
// SC paired data never auto-populates chainL even though both chains
// hang off the same anchor — the user opts in via the LC checkbox.

export const platforma = BlockModelV3.create(blockDataModel)
  .args((data): BlockArgs => {
    if (!data.datasetRef || !data.datasetFacts) {
      throw new Error("Select a dataset");
    }
    const facts = data.datasetFacts;
    const isSC = facts.clonotypeKeyAxisName === SC_AXIS;
    // No BCR/TCR or CDR3/abundance re-check here: the datasetOptions gate only
    // offers BCR datasets with those columns present, and the workflow asserts
    // them at run time — so re-validating a gated pick would be dead code.

    // ---- Heavy slot (always from the dataset when it has heavy) ---
    let chainH: PlRef | undefined;
    let chainHName: string | undefined;
    const datasetHeavy = facts.chains.find(isHeavy);
    if (datasetHeavy) {
      chainH = data.datasetRef;
      chainHName = datasetHeavy;
    }

    // ---- Light slot (explicit per R66) ----------------------------
    // Two sources, mutually exclusive — both on the SAME dataset anchor:
    //  1. dataset is bulk-light        → chainL ← the dataset pick;
    //  2. SC paired + processLightChain → chainL ← the same anchor (heavy
    //     and light hang off it as column-domain siblings).
    let chainL: PlRef | undefined;
    let chainLName: string | undefined;
    let chainLFacts: UpstreamFacts | undefined;
    const datasetLight = facts.chains.find(isLight);
    if (datasetLight && !datasetHeavy) {
      chainL = data.datasetRef;
      chainLName = datasetLight;
      chainLFacts = facts;
    } else if (data.processLightChain) {
      const lightName = facts.chains.find(isLight);
      if (lightName) {
        chainL = data.datasetRef;
        chainLName = lightName;
        chainLFacts = facts;
      }
    }
    // No `!chainH && !chainL` check needed: the datasetOptions gate only offers
    // BCR datasets (a heavy or light chain), so at least one slot is filled.

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
    // to filter sibling columns to the right chain. The light chain rides
    // the same anchor as the heavy, so its SC mode matches the dataset's.
    const lightIsSC = chainLFacts?.clonotypeKeyAxisName === SC_AXIS;

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
      if (isSC) args.chainHScLetter = SC_LETTER_FROM_CHAIN[chainHName!];
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
    // R69 — single-sample export. Not required (export is conditional on
    // it being set); projected only when a non-empty sampleId is chosen.
    // Truthy guard (not `!== undefined`): a cleared `PlDropdown` yields an
    // empty string, which must count as "no selection" — otherwise the
    // workflow would run the export collapse with a filter matching no
    // rows (re-reading the whole TSV + re-importing per block every run).
    if (data.exportSampleId) {
      args.exportSampleId = data.exportSampleId;
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
    const selectedRef = ctx.data.datasetRef;
    return broad.filter((opt) => {
      // Keep the already-selected dataset present unconditionally. Otherwise,
      // when post-run pool churn briefly fails its CDR3-readiness gate below,
      // it drops out of the options and the `required` dropdown reconciles to
      // another dataset — firing onPickDataset and clobbering the datasetRef snapshot
      // (the transient IG-Heavy → IG-Light flip with a spurious "no BCR chain"
      // alert, healing when the pool settles). The gate only needs to stop a
      // *new* pick of a not-ready dataset, not destabilise an existing one.
      if (
        selectedRef &&
        opt.ref.blockId === selectedRef.blockId &&
        opt.ref.name === selectedRef.name
      ) {
        return true;
      }
      const spec = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      if (!spec) return false;
      const axisName = spec.axesSpec[1]?.name;
      let chainOk: boolean;
      if (axisName === SC_AXIS) {
        const receptor = spec.axesSpec[1]?.domain?.["pl7.app/vdj/receptor"];
        chainOk = receptor === SC_BCR_RECEPTOR;
      } else {
        // Bulk path: chain in axis or column domain.
        const chain =
          spec.domain?.["pl7.app/vdj/chain"] ?? spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
        chainOk = !!chain && !chain.startsWith("TCR") && (isHeavy(chain) || isLight(chain));
      }
      if (!chainOk) return false;
      // Exclude scFv constructs (engineered single-chain VH-linker-VL): out of
      // scope for repertoire convergence (in-vivo only), and they'd otherwise
      // pass here as SC-paired IG. `pl7.app/vdj/scFv-sequence` is the platform's
      // scFv marker (clonotype-clustering / -space / sequence-embeddings key off
      // it too); the scClonotypeKey/structure domain is an unfinished
      // placeholder shared with paired SC, so it can't discriminate.
      const scFv = ctx.resultPool.getAnchoredPColumns({ main: opt.ref }, [
        { name: "pl7.app/vdj/scFv-sequence" },
      ]);
      if (scFv && scFv.length > 0) return false;
      // CDR3-readiness gate. Only offer a dataset once its CDR3 sibling
      // specs are present in the pool. This closes a snapshot-timing race:
      // right after a block reload the result pool repopulates incrementally
      // and there is a window where the anchor column is present but its
      // CDR3 siblings are not yet. Without this gate a user could pick
      // during that window and the args/alert snapshot (datasetFacts) would
      // freeze a false "missing CDR3" until re-pick — and a published
      // version update reloads the same way, so this is user-facing.
      // discoverUpstreamFacts is the same check factsByRef/the snapshot use,
      // so an offered dataset always has CDR3 facts ready at pick time;
      // during the window the dataset simply appears a moment later.
      const facts = discoverUpstreamFacts(ctx, opt.ref);
      return !!facts && facts.hasAaCDR3 && facts.hasNtCDR3 && facts.hasAbundance;
    });
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

  // Canonical id of the args that produced the current render (activeArgs).
  // Changes only when a Run actually commits new args — so the UI can
  // auto-close the Settings panel deterministically, regardless of run
  // duration or whether the transient `isRunning` edge was observed. The
  // isRunning-only close raced on the running-state sync and missed fast /
  // cached recomputes (threshold or export-sample changes).
  .output("runArgsId", (ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    return args ? canonicalize(args as unknown as Record<string, unknown>) : undefined;
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
    if (!ctx.data.datasetRef) return undefined;
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
    const anchor = ctx.resultPool.getPColumnByRef(ctx.data.datasetRef);
    if (!anchor) return undefined;
    const samples = getUniquePartitionKeys(anchor.data)?.[0];
    if (!samples) return undefined;
    return [createPlDataTableSheet(ctx, anchor.spec.axesSpec[0], samples)];
  })

  // R75 — options for the "Sample to export" picker. value = raw sampleId,
  // label = human sample name (findLabels resolves the pl7.app/label column
  // on the sampleId axis, same source createPlDataTableSheet uses). Sourced
  // from the UPSTREAM anchor's partition keys, so it's available before this
  // block's first run — deliberately NOT gated on getIsReadyOrError, unlike
  // mainTableSheets. Undefined until a dataset is picked.
  .output("exportSampleOptions", (ctx) => {
    if (!ctx.data.datasetRef) return undefined;
    const anchor = ctx.resultPool.getPColumnByRef(ctx.data.datasetRef);
    if (!anchor) return undefined;
    const samples = getUniquePartitionKeys(anchor.data)?.[0];
    if (!samples) return undefined;
    const labels = ctx.resultPool.findLabels(anchor.spec.axesSpec[0]);
    return samples.map((v) => ({ value: String(v), label: labels?.[v] ?? String(v) }));
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

  // Per-sample run logs (R44/R45). The per-sample fan-out captures each
  // sample's compute-neighbours stdout as String content, collected into a
  // Resource keyed by sampleId. Read each partition's text and attach the real
  // sample label (findLabels on the anchor's sampleId axis), sorted by label.
  //
  // `addEntriesWithNoData: true`: the ResourceMap is locked with all sampleId
  // keys up front, but a sample's content only resolves once it finishes — so
  // every sample appears immediately with `text: undefined` until then. The UI
  // shows a "Starting…" placeholder for those and swaps in the full log once
  // ready (one atomic step, no blink). `getDataAsString` returns undefined
  // while computing (no throw) and registers readiness, so the lambda re-runs
  // when each sample's content lands. Plain (NOT retentive) output so the swap
  // re-renders. SC paired mode emits both chains — the UI stacks them.
  .output("perSampleLogsHeavy", (ctx) => {
    const acc = ctx.outputs?.resolve({
      field: "heavyPerSampleLogs",
      assertFieldType: "Input",
      allowPermanentAbsence: true,
    });
    if (!acc) return undefined;
    // getIsReadyOrError() registers the per-sample readiness dependency so the
    // lambda re-runs (text undefined -> full log) when each sample's content
    // lands; getDataAsString returns undefined while not ready (no throw).
    const parsed = parseResourceMap(
      acc,
      (a) => (a.getIsReadyOrError() ? a.getDataAsString() : undefined),
      true,
    );
    if (parsed.data.length === 0) return undefined;
    const ref = (ctx.activeArgs as BlockArgs | undefined)?.chainH;
    const axis = ref ? ctx.resultPool.getPColumnSpecByRef(ref)?.axesSpec[0] : undefined;
    const labels = axis ? ctx.resultPool.findLabels(axis) : undefined;
    return parsed.data
      .map((e) => {
        const sampleId = String(e.key[0]);
        return { sampleId, label: labels?.[sampleId] ?? sampleId, text: e.value };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  })
  .output("perSampleLogsLight", (ctx) => {
    const acc = ctx.outputs?.resolve({
      field: "lightPerSampleLogs",
      assertFieldType: "Input",
      allowPermanentAbsence: true,
    });
    if (!acc) return undefined;
    // getIsReadyOrError() registers the per-sample readiness dependency so the
    // lambda re-runs (text undefined -> full log) when each sample's content
    // lands; getDataAsString returns undefined while not ready (no throw).
    const parsed = parseResourceMap(
      acc,
      (a) => (a.getIsReadyOrError() ? a.getDataAsString() : undefined),
      true,
    );
    if (parsed.data.length === 0) return undefined;
    const ref = (ctx.activeArgs as BlockArgs | undefined)?.chainL;
    const axis = ref ? ctx.resultPool.getPColumnSpecByRef(ref)?.axesSpec[0] : undefined;
    const labels = axis ? ctx.resultPool.findLabels(axis) : undefined;
    return parsed.data
      .map((e) => {
        const sampleId = String(e.key[0]);
        return { sampleId, label: labels?.[sampleId] ?? sampleId, text: e.value };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  })

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  // R55 — page-header subtitle. Returns undefined when nothing
  // meaningful to show; the page binds it as a placeholder.
  .output("subtitleText", (ctx) => formatSubtitle(ctx.data))

  // Heavy-chain p-frame for the heavy histogram. Conditional on the
  // heavy pipeline running (workflow's `convergencePf` output is only
  // emitted when args.chainH is set). The workflow bundles sample-
  // label + clone-label columns into convergencePf so the histogram
  // already has the labels it needs — model just passes them through
  // with ctx.createPFrame (no broad enrichment).
  .outputWithStatus("histogramPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "convergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return ctx.createPFrame(pCols);
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

  // Light-chain p-frame for the light histogram. See histogramPf
  // above — labels come from the workflow's lightConvergencePf.
  .outputWithStatus("lightHistogramPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "lightConvergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return ctx.createPFrame(pCols);
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

  // Skipped-samples warning (R12), derived model-side from the per-sample
  // status sidecars (one { nUniqueNt, nMin } per sample, keyed by sampleId).
  // A sample is absent from the convergence output iff its unique-nt-CDR3
  // count is below nMin; this splits that into:
  //   belowMin — 0 < nUniqueNt < nMin: real but too few; lowering nMin helps.
  //   noCdr3   — nUniqueNt == 0: no usable CDR3; nMin won't help.
  //   allEmpty — the whole chain produced nothing usable.
  // Labels via findLabels on the anchor's sampleId axis; nMin from the run's
  // status (falls back to activeArgs). Gated on parse completeness so the
  // warning doesn't flicker on partial mid-run status. UI surfaces a PlAlert
  // above the main table per case.
  .output("heavySkippedSamples", (ctx) => {
    const acc = ctx.outputs?.resolve({
      field: "heavyPerSampleStatus",
      assertFieldType: "Input",
      allowPermanentAbsence: true,
    });
    if (!acc) return undefined;
    const parsed = parseResourceMap(
      acc,
      (a) => a.getDataAsJson<{ nUniqueNt: number; nMin: number }>(),
      false,
    );
    if (!parsed.isComplete) return undefined;
    const args = ctx.activeArgs as BlockArgs | undefined;
    const axis = args?.chainH
      ? ctx.resultPool.getPColumnSpecByRef(args.chainH)?.axesSpec[0]
      : undefined;
    const labels = axis ? ctx.resultPool.findLabels(axis) : undefined;
    const nMin = parsed.data[0]?.value.nMin ?? args?.nMin;
    const belowMin: string[] = [];
    const noCdr3: string[] = [];
    for (const e of parsed.data) {
      const label = labels?.[String(e.key[0])] ?? String(e.key[0]);
      if (e.value.nUniqueNt === 0) noCdr3.push(label);
      else if (nMin !== undefined && e.value.nUniqueNt < nMin) belowMin.push(label);
    }
    belowMin.sort((a, b) => a.localeCompare(b));
    noCdr3.sort((a, b) => a.localeCompare(b));
    const allEmpty = parsed.data.length === 0 || parsed.data.every((e) => e.value.nUniqueNt === 0);
    return { belowMin, noCdr3, allEmpty, nMin };
  })
  .output("lightSkippedSamples", (ctx) => {
    const acc = ctx.outputs?.resolve({
      field: "lightPerSampleStatus",
      assertFieldType: "Input",
      allowPermanentAbsence: true,
    });
    if (!acc) return undefined;
    const parsed = parseResourceMap(
      acc,
      (a) => a.getDataAsJson<{ nUniqueNt: number; nMin: number }>(),
      false,
    );
    if (!parsed.isComplete) return undefined;
    const args = ctx.activeArgs as BlockArgs | undefined;
    const axis = args?.chainL
      ? ctx.resultPool.getPColumnSpecByRef(args.chainL)?.axesSpec[0]
      : undefined;
    const labels = axis ? ctx.resultPool.findLabels(axis) : undefined;
    const nMin = parsed.data[0]?.value.nMin ?? args?.nMin;
    const belowMin: string[] = [];
    const noCdr3: string[] = [];
    for (const e of parsed.data) {
      const label = labels?.[String(e.key[0])] ?? String(e.key[0]);
      if (e.value.nUniqueNt === 0) noCdr3.push(label);
      else if (nMin !== undefined && e.value.nUniqueNt < nMin) belowMin.push(label);
    }
    belowMin.sort((a, b) => a.localeCompare(b));
    noCdr3.sort((a, b) => a.localeCompare(b));
    const allEmpty = parsed.data.length === 0 || parsed.data.every((e) => e.value.nUniqueNt === 0);
    return { belowMin, noCdr3, allEmpty, nMin };
  })

  // mainTable (R52). Anchored on the dataset's fastStar column —
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
      const spec = v.column.spec;
      if (!spec.name.startsWith("pl7.app/vdj/convergence/")) return true;
      if (thisBlockId === undefined) return true; // can't filter without own block id; keep all
      if (spec.domain?.["pl7.app/block"] !== thisBlockId) return false; // other block's convergence
      // Drop our single-sample EXPORT family (R70) from the block's own
      // table — it's downstream-only. With a sample picked, those columns
      // are in the result pool, and enrichment broadcasts them across
      // samples (showing "— <sample>" labels). The internal multi-sample
      // columns carry the sampleId axis; the export columns are clonotype-
      // only, so this keeps the former and drops the latter.
      return spec.axesSpec.some((a) => a.name === "pl7.app/sampleId");
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
    const ready = ctx.data.datasetRef !== undefined && args !== undefined;
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

import type {
  InferOutputsType,
  PColumnSpec,
  PFrameHandle,
  PlRef,
  RenderCtx,
} from "@platforma-sdk/model";
import {
  BlockModelV3,
  createPlDataTableSheet,
  createPlDataTableV3,
  discoverTableColumnSnaphots,
  getUniquePartitionKeys,
  isPColumnSpec,
  parseResourceMap,
} from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import {
  DEFAULT_ALPHA,
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

// chainL is only populated when the user makes it explicit:
//  - bulk-light dataset (its only chain → chainL ← the dataset), or
//  - SC paired + processLightChain (chainL ← the same anchor).
// SC paired data never auto-populates chainL even though both chains
// hang off the same anchor — the user opts in via the LC checkbox.

// Skipped-samples warning, shared by both chains. Reads a per-sample
// status sidecar (one { nUniqueNt, nMin } per sample, keyed by sampleId) and
// splits samples into:
//   noCdr3   — nUniqueNt == 0: no usable CDR3; lowering nMin won't help.
//   belowMin — 0 < nUniqueNt < nMin: real but too few; lowering nMin helps.
//   allEmpty — no per-sample status at all (no rows → no explanation). The
//              every-sample-empty case is intentionally excluded: those samples
//              are already listed in noCdr3, so folding them in here would
//              double-alert ("no chain data" + "N with no usable CDR3").
// Labels via findLabels on the chain anchor's sampleId axis; nMin from the run's
// status (falls back to activeArgs). Gated on parse completeness so the warning
// doesn't flicker on partial mid-run status.
function buildSkippedSamples<A, U>(
  ctx: RenderCtx<A, U>,
  statusField: string,
  chainRef: (args: BlockArgs) => PlRef | undefined,
) {
  const acc = ctx.outputs?.resolve({
    field: statusField,
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
  const ref = args ? chainRef(args) : undefined;
  const axis = ref ? ctx.resultPool.getPColumnSpecByRef(ref)?.axesSpec[0] : undefined;
  const labels = axis ? ctx.resultPool.findLabels(axis) : undefined;
  const nMin = parsed.data[0]?.value?.nMin ?? args?.nMin;
  const belowMin: string[] = [];
  const noCdr3: string[] = [];
  for (const e of parsed.data) {
    const label = labels?.[String(e.key[0])] ?? String(e.key[0]);
    if (e.value.nUniqueNt === 0) noCdr3.push(label);
    else if (nMin !== undefined && e.value.nUniqueNt < nMin) belowMin.push(label);
  }
  belowMin.sort((a, b) => a.localeCompare(b));
  noCdr3.sort((a, b) => a.localeCompare(b));
  const allEmpty = parsed.data.length === 0;
  return { belowMin, noCdr3, allEmpty, nMin };
}

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

    // ---- Light slot (explicit) ------------------------------------
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

    // ---- Method (full-STAR vs fast-STAR) + thresholds -------------
    // Method per chain comes from the Pgen-availability snapshot (facts):
    // Pgen present → full-STAR (uses alpha); absent → fast-STAR fallback
    // (uses the per-chain threshold). Mixing the two in one run is designed
    // out (A-0003): both processed chains must share a method. The UI disables
    // the light opt-in in the mixed case; this gates a stale/forced state.
    if (chainH && chainL && facts.hasPgenHeavy !== facts.hasPgenLight) {
      throw new Error(
        "Heavy and light chains differ in Generation Probability availability — full-STAR and " +
          "fast-STAR can't be " +
          "combined in one run. Process a single chain, or run Generation Probability for both.",
      );
    }
    // The fast-STAR threshold is required only for a chain running in fallback
    // (no Pgen). full-STAR needs no threshold.
    if (chainH && !facts.hasPgenHeavy && data.thresholdH === undefined) {
      throw new Error("Heavy-chain threshold is required (fast-STAR fallback)");
    }
    if (chainL && !facts.hasPgenLight && data.thresholdL === undefined) {
      throw new Error("Light-chain threshold is required (fast-STAR fallback)");
    }

    // ---- nMin -----------------------------------------------------
    if (data.nMin === undefined) {
      throw new Error("Minimum unique CDR3 per sample is required");
    }

    // ---- Cluster filter -------------------------------------------
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
      alpha: data.alpha ?? DEFAULT_ALPHA,
      applyClusterFilter,
      customBlockLabel: data.customBlockLabel,
      defaultBlockLabel: getDefaultBlockLabel(data),
    };
    if (chainH) {
      args.chainH = chainH;
      args.chainHName = chainHName;
      args.hasPgenHeavy = facts.hasPgenHeavy;
      // The Pgen ref establishes convergence's dependency on gen-prob so the
      // workflow can resolve Pgen data by ref. Projected only for full-STAR.
      if (facts.hasPgenHeavy) args.pgenRefHeavy = facts.pgenRefHeavy;
      // Threshold projected only in fallback — keeps it out of the full-STAR
      // args so editing an (irrelevant, hidden) threshold can't stale the run.
      if (!facts.hasPgenHeavy) args.thresholdH = data.thresholdH;
      if (isSC) args.chainHScLetter = SC_LETTER_FROM_CHAIN[chainHName!];
    }
    if (chainL) {
      args.chainL = chainL;
      args.chainLName = chainLName;
      args.hasPgenLight = facts.hasPgenLight;
      if (facts.hasPgenLight) args.pgenRefLight = facts.pgenRefLight;
      if (!facts.hasPgenLight) args.thresholdL = data.thresholdL;
      if (lightIsSC) args.chainLScLetter = SC_LETTER_FROM_CHAIN[chainLName!];
    }
    if (clusterMin !== undefined) {
      args.clusterMin = clusterMin;
    }

    // ---- Clonotype-only aggregation (A-0011) ----------------------
    // The metadata refs, projected here, establish the samples-block dependency
    // so the workflow can resolve the columns; all optional (absent → default
    // aggregation). k >= 2 replicability needs a grouping (else k = 1).
    if (data.expectedFilterRef) {
      args.expectedFilterRef = data.expectedFilterRef;
      if (data.expectedValues && data.expectedValues.length > 0) {
        args.expectedValues = data.expectedValues;
      }
    }
    if (data.groupingRef) {
      // A grouping alone turns on cross-donor reproducibility (k=2) and the
      // support half of starScore (A-0011) — no separate toggle / k field.
      args.groupingRef = data.groupingRef;
      args.replicabilityK = 2;
    }
    args.scoreWeight = data.scoreWeight ?? 0.5;
    return args;
  })

  // Dropdown offers any BCR-compatible anchor. Two shapes:
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
    // Undefined while the block runs. usePlDataTableSettingsV2 only shows the
    // running/loading overlay when it takes the `sourceId: null` branch
    // (pending: !model.stable); a table with a defined sourceId and no sheets
    // (the aggregated Main table) would otherwise sit on the not-ready
    // placeholder for the whole run. The per-sample table gets this for free
    // because its `sheets` go undefined mid-run; the aggregated table has no
    // sheets, so the sourceId is its only lever. Returning undefined here routes
    // it into the pending branch → the running overlay shows.
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
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

  // Sample picker above the mainTable. Extracts unique sampleId
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

  // Whether the LAST RUN fell back to fast-STAR for any processed chain —
  // read from activeArgs (what actually ran), so the MainPage banner reflects
  // the current results, not the pending edit state. Config-time method (for
  // the Settings panel) comes from the datasetFacts snapshot in `data`.
  .output("ranFallback", (ctx) => {
    const a = ctx.activeArgs as BlockArgs | undefined;
    if (!a) return false;
    return (
      (a.chainH !== undefined && a.hasPgenHeavy === false) ||
      (a.chainL !== undefined && a.hasPgenLight === false)
    );
  })

  // LIVE Generation Probability availability for the picked dataset (A-0010).
  // Re-discovers gen-prob's Pgen from the CURRENT result pool every render (not
  // the pick-time snapshot), so the method + Pgen ref track gen-prob being
  // added / removed / re-created. The args callback can't reach the pool (it
  // receives only `data`), so a UI watcher mirrors this into
  // `data.datasetFacts` to keep args fresh — this output is the single live
  // source both the UI and that sync read. Undefined when no dataset is picked
  // or the dataset spec isn't resolvable yet (transient pool churn) — callers
  // keep the last-synced snapshot in that window rather than flip.
  .output("pgenStatus", (ctx) => {
    if (!ctx.data.datasetRef) return undefined;
    const facts = discoverUpstreamFacts(ctx, ctx.data.datasetRef);
    if (!facts) return undefined;
    return {
      hasPgenHeavy: facts.hasPgenHeavy,
      hasPgenLight: facts.hasPgenLight,
      pgenRefHeavy: facts.pgenRefHeavy,
      pgenRefLight: facts.pgenRefLight,
    };
  })

  // Sample-metadata columns (sampleId-keyed, name `pl7.app/metadata`) offered
  // for the aggregation's expected-sample filter and independence grouping
  // (A-0011). Same discovery idiom as differential-clonotype-abundance.
  .output("metadataOptions", (ctx) =>
    ctx.resultPool.getOptions((spec) => isPColumnSpec(spec) && spec.name === "pl7.app/metadata"),
  )

  // PFrame of the picked expected-filter column, so the UI can fetch its unique
  // values (getUniqueValues) to populate the expected-values multiselect.
  .output("expectedValueSource", (ctx) => {
    if (!ctx.data.expectedFilterRef) return undefined;
    const col = ctx.resultPool.getPColumnByRef(ctx.data.expectedFilterRef);
    if (!col) return undefined;
    return ctx.createPFrame([col]);
  })

  // Canonical(PlRef) → UpstreamFacts for every dropdown option. The
  // UI snapshot writer reads this to write ref + facts in one tick.
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

  // Per-sample run logs. The per-sample fan-out captures each
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

  // Page-header subtitle. Returns undefined when nothing
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
      ?.getDataAsJson<{ above: number; total: number }>(),
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
      ?.getDataAsJson<{ above: number; total: number }>(),
  )

  // Skipped-samples warning per chain — see buildSkippedSamples. UI
  // surfaces a PlAlert above the main table per case.
  .output("heavySkippedSamples", (ctx) =>
    buildSkippedSamples(ctx, "heavyPerSampleStatus", (a) => a.chainH),
  )
  .output("lightSkippedSamples", (ctx) =>
    buildSkippedSamples(ctx, "lightPerSampleStatus", (a) => a.chainL),
  )

  // mainTable. Anchored on the dataset's starHit column —
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
    const starHitSpec = pCols?.find((c) => c.spec.name === "pl7.app/vdj/convergence/starHit")?.spec;
    if (!starHitSpec) return undefined;

    // Enrichment pulls every column sharing the anchor's axes from the
    // result pool — including convergence columns from OTHER convergence
    // blocks upstream. Discover first, then drop those in JS: an exclude
    // selector can't express "block != this one" (the spec driver's regex
    // runs in wasm/Rust, which has no negative lookahead), so we filter by
    // the block domain here. This block's id sits on the anchor's own
    // domain (pl7.app/block).
    const thisBlockId = starHitSpec.domain?.["pl7.app/block"];
    const variants = discoverTableColumnSnaphots(ctx, {
      anchors: { main: starHitSpec },
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
        // metadata) — the sample sheet pins one sampleId at a time,
        // so these columns would just repeat the picked value
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
      // Drop our single-sample EXPORT family from the block's own
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
          // `columns`. The sample sheet pins one sampleId at a time,
          // so they'd just repeat the picked value on every row. Must come
          // before the `pl7.app/label` rule below, which would otherwise
          // force the Sample label visible.
          {
            match: (spec: PColumnSpec) =>
              spec.axesSpec.length === 1 && spec.axesSpec[0]?.name === "pl7.app/sampleId",
            visibility: "hidden",
          },
          // Force `pl7.app/label` (clonotype-id label) to default-visible
          // — some MiXCR builds emit it with `visibility: "optional"` in
          // its own annotations, so without this rule the Clone ID column
          // shows up hidden on server runs. The Sample label is
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

  // Clonotype-only aggregated table (A-0011) — the DEFAULT (Main) view and the
  // downstream-consumable shape (A-0015): one row per clonotype (starScore +
  // starHit, no sampleId axis → no sample sheet). Anchored on the populated
  // chain (heavy if present, else light); in dual-chain SC only the heavy family
  // is tabled here (the light family still exports to the pool).
  .outputWithStatus("aggregatedTable", (ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    if (!args) return undefined;
    const field = args.chainH !== undefined ? "heavyAggregatedPf" : "lightAggregatedPf";
    const ref = args.chainH ?? args.chainL;
    if (!ref) return undefined;
    if (!ctx.resultPool.getPColumnSpecByRef(ref)) return undefined;

    // Anchor on this block's aggregated (clonotype-only) starHit column.
    // Resolve the pframe with a PLAIN field (no allowPermanentAbsence): during a
    // run the field isn't ready yet, and a plain resolve marks the render
    // context UNSTABLE, so outputWithStatus reports "loading" and the table
    // shows the running overlay. `allowPermanentAbsence: true` would instead
    // treat the missing field as a stable absence → the not-ready placeholder
    // stays up during the whole run (this view has no `sheets` to drive the
    // pending state, so the model status is the only signal). The field always
    // exists for the chosen chain (args.chainH/L gates which one we request).
    const pCols = ctx.outputs?.resolve(field)?.getPColumns();
    const starHitSpec = pCols?.find((c) => c.spec.name === "pl7.app/vdj/convergence/starHit")?.spec;
    if (!starHitSpec) return undefined;

    // Same enrichment as the per-sample mainTable, but on the clonotype-only
    // axis: pull every column sharing the clonotypeKey axis from the pool
    // (Clone ID, genes, CDR3, abundance, other blocks' clonotype-keyed
    // columns) so they're available in the column settings — hidden by
    // default, convergence columns default-visible. maxHops:0 keeps
    // enrichment to the anchor's own axis (no linker hops into cluster/space
    // axis systems).
    const thisBlockId = starHitSpec.domain?.["pl7.app/block"];
    const variants = discoverTableColumnSnaphots(ctx, {
      anchors: { main: starHitSpec },
      selector: {
        mode: "enrichment",
        maxHops: 0,
        // One row per clonotype: drop any column carrying a sampleId axis (the
        // per-sample convergence family — including the exported neighbours
        // column — and per-sample metadata) so enrichment doesn't fan the
        // table back out over samples. partialAxesMatch:true excludes columns
        // that merely INCLUDE sampleId, not only exact [sampleId].
        exclude: [
          {
            axes: [{ name: [{ type: "exact", value: "pl7.app/sampleId" }] }],
            partialAxesMatch: true,
          },
        ],
      },
    });
    if (!variants) return undefined;

    // Keep all non-convergence enrichment and this block's own convergence
    // columns; drop convergence columns produced by other instances of this
    // block (see mainTable for the same rationale).
    const ownVariants = variants.filter((v) => {
      const spec = v.column.spec;
      if (!spec.name.startsWith("pl7.app/vdj/convergence/")) return true;
      if (thisBlockId === undefined) return true;
      return spec.domain?.["pl7.app/block"] === thisBlockId;
    });

    return createPlDataTableV3(ctx, {
      columns: ownVariants,
      tableState: ctx.data.aggregatedTableState,
      displayOptions: {
        visibility: [
          // Force the clonotype-id label (Clone ID) default-visible — some
          // MiXCR builds annotate it "optional".
          {
            match: (spec: PColumnSpec) => spec.name === "pl7.app/label",
            visibility: "default",
          },
          // Everything else that isn't a clonotype-key axis or a convergence
          // column starts optional (hidden, available in the column panel).
          {
            match: (spec: PColumnSpec) => {
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

  // Per-chain aggregated-score histogram PFrames (A-0015): the exported
  // clonotype-only starScore grouped by starHit — the distribution companion to
  // the aggregated Main table. Built from the aggregated family.
  .outputWithStatus("scoreHistogramPfHeavy", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "heavyAggregatedPf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return ctx.createPFrame(pCols);
  })
  .output("scoreHistogramPfHeavyPcols", (ctx) => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "heavyAggregatedPf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }));
  })
  .outputWithStatus("scoreHistogramPfLight", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "lightAggregatedPf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined) return undefined;
    return ctx.createPFrame(pCols);
  })
  .output("scoreHistogramPfLightPcols", (ctx) => {
    const pCols = ctx.outputs
      ?.resolve({
        field: "lightAggregatedPf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }));
  })

  // Sections (A-0015): the aggregated clonotype-only table is the default (Main)
  // view — the shape downstream consumes; the per-sample table is a separate
  // section. Each processed chain adds a Convergence-score histogram (the
  // aggregated starScore, grouped by starHit) and a per-sample-score histogram
  // (the per-sample statistic — −log10 p in full-STAR, nbFreq in fast-STAR).
  .sections((ctx) => {
    const args = ctx.activeArgs as BlockArgs | undefined;
    const ready = ctx.data.datasetRef !== undefined && args !== undefined;
    const hasHeavy = ready && args?.chainH !== undefined;
    const hasLight = ready && args?.chainL !== undefined;
    const dualChain = hasHeavy && hasLight;

    const sections: {
      type: "link";
      href:
        | "/"
        | "/per-sample"
        | "/convergence/score-heavy"
        | "/convergence/score-light"
        | "/convergence/heavy"
        | "/convergence/light";
      label: string;
    }[] = [{ type: "link" as const, href: "/" as const, label: "Main" }];

    if (hasHeavy) {
      sections.push({
        type: "link" as const,
        href: "/convergence/score-heavy" as const,
        label: dualChain ? "Score distribution (heavy)" : "Score distribution",
      });
    }
    if (hasLight) {
      sections.push({
        type: "link" as const,
        href: "/convergence/score-light" as const,
        label: dualChain ? "Score distribution (light)" : "Score distribution",
      });
    }
    if (hasHeavy || hasLight) {
      sections.push({
        type: "link" as const,
        href: "/per-sample" as const,
        label: "Per-sample table",
      });
    }
    if (hasHeavy) {
      sections.push({
        type: "link" as const,
        href: "/convergence/heavy" as const,
        label: dualChain ? "Per-sample distribution (heavy)" : "Per-sample distribution",
      });
    }
    if (hasLight) {
      sections.push({
        type: "link" as const,
        href: "/convergence/light" as const,
        label: dualChain ? "Per-sample distribution (light)" : "Per-sample distribution",
      });
    }
    return sections;
  })

  .title(() => "Clonotype Convergence")
  .subtitle((ctx) => ctx.data.customBlockLabel || formatSubtitle(ctx.data) || "")

  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;

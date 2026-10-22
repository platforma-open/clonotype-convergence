import type {
  ColumnRecipe,
  ColumnUniversalId,
  ColumnVisibilityRule,
  InferOutputsType,
  PColumnSpec,
  PFrameHandle,
  RenderCtxBase,
  ArgsIssue,
} from "@platforma-sdk/model";
import {
  BlockModelV3,
  ColumnsCollection,
  createColumnValuesSource,
  createPlDataTableSheet,
  createPlDataTableV3,
  deriveAxisValuesLabels,
  getUniquePartitionKeys,
  hasReachableData,
  parseResourceMap,
  TreeNodeAccessor,
} from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import {
  DEFAULT_ALPHA,
  formatSubtitle,
  getDefaultBlockLabel,
  isHeavy,
  isLight,
  pgenHeavyAvailable,
  pgenLightAvailable,
  SC_AXIS,
  SC_LETTER_FROM_CHAIN,
} from "./chains";
import {
  axisSelector,
  exact,
  findColumn,
  getOutputColumns,
  resultPool,
  toIdsAndSpecs,
} from "./columns";
import { blockDataModel } from "./dataModel";
import { getDatasetCandidates, getDatasetOptions } from "./dataset";
import { discoverUpstreamFacts } from "./facts";
import { getMetadataOptions } from "./metadata";
import { kind } from "@platforma-open/milaboratories.clonotype-convergence.kind";
import type { BlockArgs, BlockData, UpstreamFacts } from "./types";

export type { BlockArgs, BlockData, UpstreamFacts };
export type { ColumnPickerOption } from "./columns";
export type { DatasetPick } from "./dataset";
export { blockDataModel } from "./dataModel";
export { toColumnId } from "./columns";
export { fromDatasetSelection, toDatasetSelection } from "./dataset";
// Shared chain constants/helpers, so the UI imports them instead of redefining.
export { isHeavy, isLight, pgenHeavyAvailable, pgenLightAvailable, SC_AXIS } from "./chains";

// chainL is only populated when the user makes it explicit:
//  - bulk-light dataset (its only chain → chainL ← the dataset), or
//  - SC paired + processLightChain (chainL ← the same anchor).
// SC paired data never auto-populates chainL even though both chains
// hang off the same anchor — the user opts in via the LC checkbox.

export const platforma = BlockModelV3.create({ dataModel: blockDataModel, kind })
  // Args are built from whatever is set; `argsIssues` below decides whether
  // they may run. A chain slot is filled only once a dataset is picked.
  .args((data): BlockArgs => {
    const facts = data.datasetFacts;
    const { heavy, light } = processedChains(data);

    const applyClusterFilter = data.applyClusterFilter ?? false;
    const args: BlockArgs = {
      nMin: data.nMin,
      alpha: data.alpha ?? DEFAULT_ALPHA,
      applyClusterFilter,
      customBlockLabel: data.customBlockLabel,
      defaultBlockLabel: getDefaultBlockLabel(data),
    };

    // SC mode → the workflow needs the scClonotypeChain LETTER ("A"/"B") to
    // filter sibling columns to the right chain. Both chains ride the same
    // anchor, so `isSC` (from the dataset's own axis name) governs both.
    if (data.datasetRef && facts) {
      const isSC = facts.clonotypeKeyAxisName === SC_AXIS;
      if (heavy !== undefined) {
        args.chainH = data.datasetRef;
        args.chainHName = heavy;
        args.hasPgenHeavy = pgenHeavyAvailable(facts);
        // full-STAR is added when Pgen is present; the id establishes the gen-prob
        // dependency so the workflow can resolve Pgen data by id.
        if (pgenHeavyAvailable(facts)) args.pgenRefHeavy = facts.pgenRefHeavy;
        // fast-STAR always runs → its threshold is always projected.
        args.thresholdH = data.thresholdH;
        if (isSC) args.chainHScLetter = SC_LETTER_FROM_CHAIN[heavy];
      }
      if (light !== undefined) {
        args.chainL = data.datasetRef;
        args.chainLName = light;
        args.hasPgenLight = pgenLightAvailable(facts);
        if (pgenLightAvailable(facts)) args.pgenRefLight = facts.pgenRefLight;
        args.thresholdL = data.thresholdL;
        if (isSC) args.chainLScLetter = SC_LETTER_FROM_CHAIN[light];
      }
    }
    if (applyClusterFilter && data.clusterMin !== undefined) {
      args.clusterMin = data.clusterMin;
    }
    if (data.filterRef) {
      args.inputFilter = data.filterRef;
    }

    // ---- Clonotype-only aggregation ----------------------
    // The metadata columns, projected here, establish the samples-block
    // dependency so the workflow can resolve them; both optional (absent → the
    // default path: every sample its own independent, eligible unit). There is
    // no other aggregation knob — `alpha` drives both BH levels.
    if (data.expectedFilterRef) {
      args.expectedFilterRef = data.expectedFilterRef;
      if (data.expectedValues.length > 0) {
        args.expectedValues = data.expectedValues;
      }
    }
    if (data.groupingRef) {
      args.groupingRef = data.groupingRef;
    }
    return args;
  })

  // Input-completeness gate. This is the ONLY thing standing between a
  // dataset that can't be processed and a Run: `datasetOptions` deliberately
  // offers every BCR anchor (gating the dropdown on sibling discovery hid
  // valid datasets for as long as any other block in the project was
  // running). Validating here instead keeps the dropdown honest AND the Run
  // button correct — and it reads the pick-time SNAPSHOT, which cannot
  // flicker with pool churn the way a live query can.
  .argsIssues(({ data }) => {
    if (!data.datasetRef || !data.datasetFacts) {
      return [{ severity: "error", message: "Select a dataset" }];
    }
    const facts = data.datasetFacts;
    const { heavy, light } = processedChains(data);
    const issues: ArgsIssue[] = [];

    // Dataset-level, not per-chain: these flags are aggregates over the
    // anchor's siblings (facts.ts). Per-chain presence stays the workflow's
    // assertion — this gate only stops the runs that cannot possibly work.
    if (!facts.hasAaCDR3 || !facts.hasNtCDR3) {
      issues.push({
        severity: "error",
        message:
          "This dataset has no amino-acid and nucleotide CDR3 columns — convergence needs both",
      });
    }
    if (!facts.hasAbundance) {
      issues.push({ severity: "error", message: "This dataset has no abundance column" });
    }

    // At least one chain slot must be filled. Nothing upstream guarantees it:
    // the dropdown offers BCR anchors without inspecting the snapshot, and a
    // snapshot whose `chains` came back empty fills neither slot — the workflow
    // then skips both chain branches and the block "succeeds" with no outputs
    // at all. Fail here instead, where it reads as a bad input.
    if (heavy === undefined && light === undefined) {
      issues.push({
        severity: "error",
        message: "No BCR chain detected in this dataset — re-select it to refresh",
      });
    }

    // ---- Method (full-STAR vs fast-STAR) + thresholds -------------
    // Parallel modes: fast-STAR runs on every processed
    // chain; full-STAR is ADDED on a chain when its Pgen is available. No
    // shared-method constraint and no disable-light — heavy and light are
    // independent. fast-STAR always runs, so its per-chain nb_freq threshold is
    // always required for each processed chain (heavy has a default; light must
    // be set explicitly).
    if (heavy !== undefined && data.thresholdH === undefined) {
      issues.push({ severity: "error", message: "Heavy-chain threshold is required" });
    }
    if (light !== undefined && data.thresholdL === undefined) {
      issues.push({ severity: "error", message: "Light-chain threshold is required" });
    }

    if (data.nMin === undefined) {
      issues.push({ severity: "error", message: "Minimum unique CDR3 per sample is required" });
    }
    if ((data.applyClusterFilter ?? false) && data.clusterMin === undefined) {
      issues.push({ severity: "error", message: "Minimum cluster size is required" });
    }
    return issues;
  })

  // Inverse of the kind's init-params contract: the dataset pick, the
  // light-chain opt-in and every analysis knob — the fields a user sets by
  // hand. `datasetFacts` and `datasetLabel` are derived from the pick (and
  // refreshed from this block's outputs by the UI), and the table / chart
  // states are view state; neither is configuration a template carries.
  .templateParams((data) => ({
    datasetRef: data.datasetRef,
    filterRef: data.filterRef,
    processLightChain: data.processLightChain,
    thresholdH: data.thresholdH,
    thresholdL: data.thresholdL,
    nMin: data.nMin,
    alpha: data.alpha,
    applyClusterFilter: data.applyClusterFilter,
    clusterMin: data.clusterMin,
    expectedFilterRef: data.expectedFilterRef,
    expectedValues: data.expectedValues,
    groupingRef: data.groupingRef,
    customBlockLabel: data.customBlockLabel,
  }))

  // Dropdown offers any BCR-compatible anchor, with its subsets — see
  // getDatasetOptions.
  .output("datasetOptions", (ctx) => getDatasetOptions(ctx, ctx.data.datasetRef))

  // Source identifier for the main table's per-source state cache.
  // Derived from `activeArgs` (= the args that produced the CURRENT
  // outputs), so it only changes after a Run completes — picking a
  // new dataset before pressing Run doesn't flip the sourceId and the
  // table stays put. After Run, the new sourceId triggers a fresh
  // hidden-columns / sort state (so stale column IDs from the old
  // dataset don't haunt the new one).
  //
  // It keys on the dataset AND on which column FAMILIES the run emits, because
  // the saved hidden-column list does not merge with the visibility rules — it
  // replaces them (`computeHiddenColumns`: `hiddenSpecs` wins outright over the
  // rule-derived optional set). So a state captured while full-STAR existed
  // keeps hiding the fast-STAR family after Pgen is removed, and with full-STAR
  // gone too the table renders empty but for the clone id. Anything that
  // changes which columns exist has to reset that state.
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
    const args = ctx.activeArgs;
    if (!args) return undefined;
    const dataset = args.chainH ?? args.chainL;
    if (!dataset) return undefined;
    return canonicalize({
      dataset,
      heavy: args.chainH !== undefined,
      light: args.chainL !== undefined,
      fullStarHeavy: args.hasPgenHeavy === true,
      fullStarLight: args.hasPgenLight === true,
      clusterFilter: args.applyClusterFilter,
    });
  })

  // Canonical id of the args that produced the current render (activeArgs).
  // Changes only when a Run actually commits new args — so the UI can
  // auto-close the Settings panel deterministically, regardless of run
  // duration or whether the transient `isRunning` edge was observed. The
  // isRunning-only close raced on the running-state sync and missed fast /
  // cached recomputes (threshold or export-sample changes).
  .output("runArgsId", (ctx) => {
    const args = ctx.activeArgs;
    return args ? canonicalize(args) : undefined;
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
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
    // From activeArgs, NOT ctx.data.datasetRef: the table this picker sits above
    // is built from the args that produced the CURRENT rows. Reading the live
    // pick instead let the two disagree — select another dataset, don't press
    // Run, and the picker listed the new dataset's samples over the old
    // dataset's data. Same source as mainTableSourceId, so sheet and table
    // always describe the same run.
    const dataset = ctx.activeArgs?.chainH ?? ctx.activeArgs?.chainL;
    if (!dataset) return undefined;
    return sampleSheets(ctx, findColumn(ctx, dataset));
  })

  // LIVE Generation Probability availability for the picked dataset.
  // Re-discovers gen-prob's Pgen from the CURRENT result pool every render (not
  // the pick-time snapshot), so the method + Pgen id track gen-prob being
  // added / removed / re-created. The args callback can't reach the pool (it
  // receives only `data`), so a UI watcher mirrors this into
  // `data.datasetFacts` to keep args fresh — this output is the single live
  // source both the UI and that sync read. Undefined when no dataset is picked
  // or the dataset spec isn't resolvable yet (transient pool churn) — callers
  // keep the last-synced snapshot in that window rather than flip.
  .output("pgenStatus", (ctx) => {
    if (!ctx.data.datasetRef) return undefined;
    const facts = discoverUpstreamFacts(ctx, ctx.data.datasetRef, ctx.data.filterRef);
    if (!facts) return undefined;
    return {
      hasPgenHeavy: pgenHeavyAvailable(facts),
      hasPgenLight: pgenLightAvailable(facts),
      pgenRefHeavy: facts.pgenRefHeavy,
      pgenRefLight: facts.pgenRefLight,
    };
  })

  // Sample-metadata columns (sampleId-keyed, name `pl7.app/metadata`) offered
  // for the aggregation's expected-sample filter and independence grouping.
  .output("metadataOptions", (ctx) => getMetadataOptions(ctx))

  // Where the UI reads the values of the expected-filter column from, for the expected-values
  // picker.
  .output("expectedFilterValues", (ctx) => {
    const expectedFilterRef = ctx.data.expectedFilterRef;
    if (expectedFilterRef === undefined) return undefined;
    return createColumnValuesSource(ctx, expectedFilterRef);
  })

  // Dataset id → UpstreamFacts for every dataset the picker can offer. The
  // UI snapshot writer reads this to write the id + facts in one tick.
  .output("factsByDataset", (ctx) => {
    const result: Record<string, UpstreamFacts> = {};
    for (const datasetId of getDatasetCandidates(ctx)) {
      const facts = discoverUpstreamFacts(ctx, datasetId, ctx.data.filterRef);
      if (facts) result[datasetId] = facts;
    }
    return result;
  })

  // Per-sample run logs. The per-sample fan-out captures each
  // sample's compute-neighbours stdout as String content, collected into a
  // Resource keyed by sampleId. Read each partition's text and attach the real
  // sample label (label column on the anchor's sampleId axis), sorted by label.
  //
  // `addEntriesWithNoData: true`: the ResourceMap is locked with all sampleId
  // keys up front, but a sample's content only resolves once it finishes — so
  // every sample appears immediately with `text: undefined` until then. The UI
  // shows a "Starting…" placeholder for those and swaps in the full log once
  // ready (one atomic step, no blink). `getDataAsString` returns undefined
  // while computing (no throw) and registers readiness, so the lambda re-runs
  // when each sample's content lands. Plain (NOT retentive) output so the swap
  // re-renders. SC paired mode emits both chains — the UI stacks them.
  .output("perSampleLogsHeavy", (ctx) =>
    buildPerSampleLogs(ctx, "heavyPerSampleLogs", (a) => a.chainH),
  )
  .output("perSampleLogsLight", (ctx) =>
    buildPerSampleLogs(ctx, "lightPerSampleLogs", (a) => a.chainL),
  )

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  // Page-header subtitle. Returns undefined when nothing
  // meaningful to show; the page binds it as a placeholder.
  .output("subtitleText", (ctx) => formatSubtitle(ctx.data))

  // Per-sample distribution p-frame: the per-sample convergence
  // columns for BOTH chains combined (heavy `convergencePf` + light
  // `lightConvergencePf`), so the single selector-driven Per-sample chart page
  // can offer every per-sample score across chain × mode. Each chain's pframe
  // bundles its own sample/clone labels; absent chains contribute nothing.
  .outputWithStatus("perSampleDistributionPf", (ctx): PFrameHandle | undefined => {
    const columns = bothChainColumns(ctx, "convergencePf", "lightConvergencePf");
    return columns ? ctx.createPFrame(columns.map((column) => column.id)) : undefined;
  })
  .output("perSampleDistributionPfPcols", (ctx) => {
    const columns = bothChainColumns(ctx, "convergencePf", "lightConvergencePf");
    return columns ? toIdsAndSpecs(columns) : undefined;
  })
  .output("heavyFastStats", (ctx) => hitStats(ctx, "heavyFastStats"))
  .output("heavyFullStats", (ctx) => hitStats(ctx, "heavyFullStats"))
  .output("lightFastStats", (ctx) => hitStats(ctx, "lightFastStats"))
  .output("lightFullStats", (ctx) => hitStats(ctx, "lightFullStats"))

  // Skipped-samples warning per chain — see buildSkippedSamples. UI
  // surfaces a PlAlert above the main table per case.
  .output("heavySkippedSamples", (ctx) =>
    buildSkippedSamples(ctx, "heavyPerSampleStatus", (a) => a.chainH),
  )
  .output("lightSkippedSamples", (ctx) =>
    buildSkippedSamples(ctx, "lightPerSampleStatus", (a) => a.chainL),
  )

  // mainTable — the per-sample QC table. Anchored on the chain's fastStar
  // column (emitted on every chain, so it is the one reliable anchor) —
  // heavy when chainH is populated (any mode that processes heavy);
  // light when only chainL is populated (bulk-light mode).
  //
  // KNOWN GAP: in dual-chain SC mode this table is heavy-only and there is no
  // light counterpart, so the light per-sample family is reachable only through
  // the Per-sample distribution chart. (Both chains' AGGREGATED families do
  // reach the Main table — they share the clonotype axis, so enrichment picks
  // up the light one.) Readiness gate avoids
  // showing partial PFrames mid-run.
  .outputWithStatus("mainTable", (ctx) => {
    const args = ctx.activeArgs;
    if (!args) return undefined;
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;

    // Pick which chain's p-frame anchors the main table. Heavy when
    // populated; else light.
    const pframeField = args.chainH !== undefined ? "convergencePf" : "lightConvergencePf";
    const dataset = args.chainH ?? args.chainL;
    if (!dataset) return undefined;
    if (findColumn(ctx, dataset) === undefined) return undefined;

    const pframe = ctx.outputs?.resolve({
      field: pframeField,
      assertFieldType: "Input",
      allowPermanentAbsence: true,
    });
    if (!pframe) return undefined;
    const anchorRecipe = pickHitAnchor(ColumnsCollection([pframe]));
    if (!anchorRecipe) return undefined;
    const hitAnchorSpec = anchorRecipe.getSpec();

    // Discover first, then filter in JS — see keepTableColumn.
    const thisBlockId = hitAnchorSpec.domain?.["pl7.app/block"];
    const discovered = ColumnsCollection()
      .discover({
        anchors: { main: hitAnchorSpec },
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
        exclude: [
          // Drop per-sample-only columns (Sample label, donor, dataset,
          // metadata) — the sample sheet pins one sampleId at a time,
          // so these columns would just repeat the picked value
          // on every row. `partialAxesMatch: false` excludes only
          // columns whose axes are *exactly* [sampleId] (multi-axis
          // columns that include sampleId stay).
          {
            axes: [{ name: [{ type: "exact", value: "pl7.app/sampleId" }] }],
            partialAxesMatch: false,
          },
          EXCLUDE_PGEN,
        ],
      })
      .getColumns();

    const keep = keepTableColumn(thisBlockId, { requireSampleIdAxis: true });
    const kept = discovered.filter(keep);
    const rest = withoutAnchor(kept, hitAnchorSpec);
    const keptSpecs = [hitAnchorSpec, ...rest.map((r) => r.getSpec())];

    // ONLY the anchor is primary — see pickHitAnchor. Everything else goes
    // through `columns`, which is the set the visibility rules can reach.
    return createPlDataTableV3(ctx, {
      primaryColumns: [anchorRecipe],
      columns: rest,
      tableState: ctx.data.mainTableState,
      displayOptions: {
        visibility: visibilityRules(args, keptSpecs, { perSampleOnly: true }),
      },
    });
  })

  // Clonotype-only aggregated table — the DEFAULT (Main) view and the
  // downstream-consumable shape: one row per clonotype (each emitted
  // mode's score, hit and reproducibility; no sampleId axis → no sample
  // sheet). Anchored on the populated
  // chain (heavy if present, else light); in dual-chain SC only the heavy family
  // is tabled here (the light family still exports to the pool).
  .outputWithStatus("aggregatedTable", (ctx) => {
    const args = ctx.activeArgs;
    if (!args) return undefined;
    const field = args.chainH !== undefined ? "heavyAggregatedPf" : "lightAggregatedPf";
    const dataset = args.chainH ?? args.chainL;
    if (!dataset) return undefined;
    if (findColumn(ctx, dataset) === undefined) return undefined;

    // Anchor on this block's aggregated (clonotype-only) fastStar column — the
    // one column every chain emits, whether or not full-STAR was added.
    // Resolve the pframe with a PLAIN field (no allowPermanentAbsence): during a
    // run the field isn't ready yet, and a plain resolve marks the render
    // context UNSTABLE, so outputWithStatus reports "loading" and the table
    // shows the running overlay. `allowPermanentAbsence: true` would instead
    // treat the missing field as a stable absence → the not-ready placeholder
    // stays up during the whole run (this view has no `sheets` to drive the
    // pending state, so the model status is the only signal). The field always
    // exists for the chosen chain (args.chainH/L gates which one we request).
    const pframe = ctx.outputs?.resolve(field);
    if (!pframe) return undefined;
    const anchorRecipe = pickHitAnchor(ColumnsCollection([pframe]));
    if (!anchorRecipe) return undefined;
    const hitAnchorSpec = anchorRecipe.getSpec();

    // Same enrichment as the per-sample mainTable, but on the clonotype-only
    // axis: pull every column sharing the clonotypeKey axis from the pool
    // (Clone ID, genes, CDR3, abundance, other blocks' clonotype-keyed
    // columns) so they're available in the column settings — hidden by
    // default, convergence columns default-visible. maxHops:0 keeps
    // enrichment to the anchor's own axis (no linker hops into cluster/space
    // axis systems).
    const thisBlockId = hitAnchorSpec.domain?.["pl7.app/block"];
    const discovered = ColumnsCollection()
      .discover({
        anchors: { main: hitAnchorSpec },
        mode: "enrichment",
        maxHops: 0,
        exclude: [
          // One row per clonotype: drop any column carrying a sampleId axis (the
          // per-sample convergence family — including the exported neighbours
          // column — and per-sample metadata) so enrichment doesn't fan the
          // table back out over samples. partialAxesMatch:true excludes columns
          // that merely INCLUDE sampleId, not only exact [sampleId].
          {
            axes: [{ name: [{ type: "exact", value: "pl7.app/sampleId" }] }],
            partialAxesMatch: true,
          },
          EXCLUDE_PGEN,
        ],
      })
      .getColumns();

    // No sampleId-axis clause here: this table IS the clonotype-only shape, so
    // our own export family is exactly what it should show.
    const keep = keepTableColumn(thisBlockId);
    const kept = discovered.filter(keep);
    const rest = withoutAnchor(kept, hitAnchorSpec);
    const keptSpecs = [hitAnchorSpec, ...rest.map((r) => r.getSpec())];

    // ONLY the anchor is primary — see pickHitAnchor. Everything else goes
    // through `columns`, which is the set the visibility rules can reach.
    return createPlDataTableV3(ctx, {
      primaryColumns: [anchorRecipe],
      columns: rest,
      tableState: ctx.data.aggregatedTableState,
      displayOptions: {
        visibility: visibilityRules(args, keptSpecs),
      },
    });
  })

  // Aggregated distribution p-frame: the exported clonotype-only
  // convergence columns for BOTH chains combined (heavy + light aggregated
  // families), so the single selector-driven Aggregated chart page can offer
  // every aggregated score across chain × mode. Absent chains contribute nothing.
  .outputWithStatus("aggregatedDistributionPf", (ctx): PFrameHandle | undefined => {
    const columns = bothChainColumns(ctx, "heavyAggregatedPf", "lightAggregatedPf");
    return columns ? ctx.createPFrame(columns.map((column) => column.id)) : undefined;
  })
  .output("aggregatedDistributionPfPcols", (ctx) => {
    const columns = bothChainColumns(ctx, "heavyAggregatedPf", "lightAggregatedPf");
    return columns ? toIdsAndSpecs(columns) : undefined;
  })

  // Sections: the aggregated clonotype-only table is the default
  // (Main) view; the per-sample table is a separate QC section. The per-chain
  // histogram routes are replaced by TWO selector-driven chart pages — an
  // Aggregated distribution and a Per-sample distribution — each offering every
  // score across chain × mode via a graph-maker data-column predicate.
  .sections((ctx) => {
    const args = ctx.activeArgs;
    const ready = ctx.data.datasetRef !== undefined && args !== undefined;
    const hasAny = ready && (args?.chainH !== undefined || args?.chainL !== undefined);

    const sections: {
      type: "link";
      href: "/" | "/per-sample" | "/distribution/aggregated" | "/distribution/per-sample";
      label: string;
    }[] = [{ type: "link" as const, href: "/" as const, label: "Main" }];

    if (hasAny) {
      sections.push(
        {
          type: "link" as const,
          href: "/distribution/aggregated" as const,
          label: "Score distribution",
        },
        { type: "link" as const, href: "/per-sample" as const, label: "Per-sample table" },
        {
          type: "link" as const,
          href: "/distribution/per-sample" as const,
          label: "Per-sample distribution",
        },
      );
    }
    return sections;
  })

  .title(() => "Clonotype Convergence")
  .subtitle((ctx) => ctx.data.customBlockLabel || formatSubtitle(ctx.data) || "")

  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;

// Internals

type Ctx = RenderCtxBase<BlockArgs, BlockData>;

/**
 * The chains the dataset pick processes, read from its snapshot; both
 * undefined while no snapshot is set.
 *  - heavy: the dataset's heavy chain, always processed when present.
 *  - light: the dataset's light chain when it is processed. Two sources,
 *    mutually exclusive, both on the SAME dataset anchor: a bulk-light dataset
 *    (its only chain, no opt-in needed), or SC paired data with
 *    `processLightChain` (heavy and light hang off the anchor as column-domain
 *    siblings).
 */
function processedChains(data: BlockData): {
  heavy: string | undefined;
  light: string | undefined;
} {
  const chains = data.datasetFacts?.chains ?? [];
  const heavy = chains.find(isHeavy);
  const datasetLight = chains.find(isLight);
  const lightProcessed = heavy === undefined || data.processLightChain === true;
  return { heavy, light: lightProcessed ? datasetLight : undefined };
}

/** sampleId → label for the dataset's sampleId axis. Undefined when the
 *  dataset or its spec isn't resolvable; callers fall back to the raw sampleId. */
function sampleLabels(ctx: Ctx, dataset: ColumnUniversalId | undefined) {
  const sampleAxis =
    dataset === undefined ? undefined : findColumn(ctx, dataset)?.getSpec().axesSpec[0];
  if (sampleAxis === undefined) return undefined;
  const labelColumns = resultPool(ctx).filter({
    include: {
      name: [exact("pl7.app/label")],
      axes: [axisSelector(sampleAxis)],
      partialAxesMatch: false,
    },
  });
  return deriveAxisValuesLabels(labelColumns)(sampleAxis);
}

// Skipped-samples warning, shared by both chains. Reads a per-sample
// status sidecar (one { nUniqueNt, nMin } per sample, keyed by sampleId) and
// splits samples into:
//   noCdr3   — nUniqueNt == 0: no usable CDR3; lowering nMin won't help.
//   belowMin — 0 < nUniqueNt < nMin: real but too few; lowering nMin helps.
//   allEmpty — no per-sample status at all (no rows → no explanation). The
//              every-sample-empty case is intentionally excluded: those samples
//              are already listed in noCdr3, so folding them in here would
//              double-alert ("no chain data" + "N with no usable CDR3").
// nMin comes from the run's status (falls back to activeArgs). Gated on parse
// completeness so the warning doesn't flicker on partial mid-run status.
function buildSkippedSamples(
  ctx: Ctx,
  statusField: string,
  chainDataset: (args: BlockArgs) => ColumnUniversalId | undefined,
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
  const args = ctx.activeArgs;
  const labels = sampleLabels(ctx, args ? chainDataset(args) : undefined);
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

/**
 * Per-sample run logs for one chain. The per-sample fan-out captures each
 * sample's compute-neighbours stdout as String content, collected into a
 * Resource keyed by sampleId. Each partition's text is returned with the real
 * sample label attached, sorted by label.
 *
 * `addEntriesWithNoData: true`: the ResourceMap is locked with all sampleId
 * keys up front, but a sample's content only resolves once it finishes — so
 * every sample appears immediately with `text: undefined` until then. The UI
 * shows a "Starting…" placeholder for those and swaps in the full log once
 * ready (one atomic step, no blink). `getIsReadyOrError()` registers the
 * per-sample readiness dependency so the lambda re-runs when each sample's
 * content lands; `getDataAsString` returns undefined while not ready (no
 * throw). Consumed by PLAIN (not retentive) outputs so the swap re-renders.
 */
function buildPerSampleLogs(
  ctx: Ctx,
  logsField: string,
  chainDataset: (args: BlockArgs) => ColumnUniversalId | undefined,
) {
  const acc = ctx.outputs?.resolve({
    field: logsField,
    assertFieldType: "Input",
    allowPermanentAbsence: true,
  });
  if (!acc) return undefined;
  const parsed = parseResourceMap(
    acc,
    (a) => (a.getIsReadyOrError() ? a.getDataAsString() : undefined),
    true,
  );
  if (parsed.data.length === 0) return undefined;
  const args = ctx.activeArgs;
  const labels = sampleLabels(ctx, args ? chainDataset(args) : undefined);
  return parsed.data
    .map((e) => {
      const sampleId = String(e.key[0]);
      return { sampleId, label: labels?.[sampleId] ?? sampleId, text: e.value };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One sheet per sample over the dataset's sampleId axis, from the sample
 * partitions of its data; `undefined` while the data is not readable.
 */
function sampleSheets(ctx: Ctx, dataset: ColumnRecipe | undefined) {
  if (dataset === undefined || !hasReachableData(dataset)) return undefined;
  const data = dataset.getData();
  if (!(data instanceof TreeNodeAccessor)) return undefined;
  const samples = getUniquePartitionKeys(data)?.[0];
  if (!samples) return undefined;
  return [createPlDataTableSheet(ctx, dataset.getSpec().axesSpec[0], samples)];
}

// gen-prob's columns. A full-STAR INPUT, not a convergence result — enrichment
// finds them on the clonotype axis, but in a convergence table they are noise.
// Excluded in the discovery selector, not in JS: a plain name match needs no
// negation, so the spec driver can express it and the columns never reach us.
const EXCLUDE_PGEN = {
  name: [
    { type: "exact" as const, value: "pl7.app/vdj/generationProbability" },
    { type: "exact" as const, value: "pl7.app/vdj/negLog10GenerationProbability" },
  ],
};

/**
 * Which enrichment-discovered columns a table keeps.
 *
 * Enrichment pulls every column sharing the anchor's axes from the result pool
 * — including convergence columns from OTHER convergence blocks upstream. An
 * exclude selector can't express "block != this one" (the spec driver's regex
 * runs in wasm/Rust, which has no negative lookahead), so the block filter runs
 * here in JS, off the block domain the anchor carries (`pl7.app/block`).
 *
 * `requireSampleIdAxis` is the per-sample table's extra clause: it additionally
 * drops OUR OWN clonotype-only export family, which is the Main view's shape and
 * which enrichment would otherwise broadcast across samples (rendering
 * "— <sample>" labels). The internal per-sample columns carry the sampleId axis;
 * the export columns don't — so the axis is what tells them apart.
 */
function keepTableColumn(
  thisBlockId: string | undefined,
  opts: { requireSampleIdAxis?: boolean } = {},
) {
  return (recipe: ColumnRecipe): boolean => {
    const spec = recipe.getSpec();
    // Everything that isn't convergence (Clone ID, genes, abundance, …) stays.
    if (!spec.name.startsWith("pl7.app/vdj/convergence/")) return true;
    if (thisBlockId === undefined) return true; // can't filter without own block id; keep all
    if (spec.domain?.["pl7.app/block"] !== thisBlockId) return false; // another block's convergence
    if (!opts.requireSampleIdAxis) return true;
    return spec.axesSpec.some((a) => a.name === "pl7.app/sampleId");
  };
}

const FAST_STAR_HIT = "pl7.app/vdj/convergence/fastStar";
const FULL_STAR_HIT = "pl7.app/vdj/convergence/fullStar";

/**
 * The hit column a table anchors on: full-STAR where the chain has it, else
 * fast-STAR. Both are emitted per chain and share the table's axes, so either
 * can carry the join — but the choice is not cosmetic.
 *
 * `createPlDataTableV3` never applies visibility rules to `primaryColumns`
 * (createPlDataTableV3.ts: `visible = { primary, direct: direct.filter(...) }`),
 * so whatever we anchor on is permanently visible. That must be the call we
 * want foregrounded, which on a full-STAR chain is full-STAR's.
 *
 * The corollary is why only the ANCHOR goes in `primaryColumns` below: with
 * `maxHops: 0` every discovered column is zero-hop, so handing the whole
 * discovery result to `primaryColumns` puts every column beyond reach of the
 * rules and nothing can ever be hidden.
 */
function pickHitAnchor(source: ColumnsCollection): ColumnRecipe | undefined {
  const byName = (name: string) =>
    source.filter({ include: [{ name: { type: "exact", value: name } }] }).getColumns()[0];
  return byName(FULL_STAR_HIT) ?? byName(FAST_STAR_HIT);
}

/**
 * The discovered columns minus the anchor, which is passed to the table
 * separately as its one primary column.
 *
 * Matched on name + domain rather than on `ColumnRecipe.id`: the anchor recipe
 * comes from the block's own output collection while these come from a
 * `discover()` collection, so the same column carries a different recipe id on
 * each side and only the spec identity is comparable. The domain half matters
 * in dual-chain SC, where the other chain's same-named hit column is a
 * legitimate table column and must not be dropped with the anchor.
 */
function withoutAnchor(recipes: ColumnRecipe[], anchor: PColumnSpec): ColumnRecipe[] {
  const domainKey = canonicalize(anchor.domain ?? {});
  return recipes.filter((r) => {
    const s = r.getSpec();
    return !(s.name === anchor.name && canonicalize(s.domain ?? {}) === domainKey);
  });
}

/** `{above,total}` hit-count badge from one of the workflow's stats fields. */
function hitStats(ctx: Ctx, field: string) {
  return ctx.outputs
    ?.resolve({ field, assertFieldType: "Input", allowPermanentAbsence: true })
    ?.getDataAsJson<{ above: number; total: number }>();
}

/**
 * Columns of BOTH chains' families for a paired (heavy, light) pair of
 * workflow fields, heavy first. An absent chain, or one whose columns are
 * still arriving, contributes nothing; undefined when neither has columns,
 * so callers can skip building an empty PFrame.
 */
function bothChainColumns(
  ctx: Ctx,
  heavyField: string,
  lightField: string,
): ColumnRecipe[] | undefined {
  const of = (field: string) =>
    getOutputColumns(
      ctx,
      ctx.outputs?.resolve({ field, assertFieldType: "Input", allowPermanentAbsence: true }),
    )?.getColumns() ?? [];
  const columns = [...of(heavyField), ...of(lightField)];
  return columns.length > 0 ? columns : undefined;
}

// The fast-STAR family the block's own tables hide on a chain that also carries
// full-STAR. Table visibility only — the columns are still emitted,
// exported to the pool, and offered by the chart pickers, so the two calls stay
// comparable; the tables just foreground the FDR-controlled one.
const FAST_STAR_COLUMN_NAMES = [
  "pl7.app/vdj/convergence/nbFreq",
  "pl7.app/vdj/convergence/fastStar",
  "pl7.app/vdj/convergence/fastStarReproducibility",
  // The cluster filter runs per mode, so its columns belong to the family of
  // the hit set they refine. Demoting them with the rest is what keeps a
  // derived column from outliving its parent in the table: showing
  // "cluster-filtered (fast-STAR)" while "hit (fast-STAR)" is hidden reads as
  // a contradiction. full-STAR's own cluster columns stay default-visible.
  "pl7.app/vdj/convergence/fastStarClusterFiltered",
  "pl7.app/vdj/convergence/fastStarClusterSize",
  "pl7.app/vdj/convergence/fastStarClusterFilteredReproducibility",
];

// Table visibility rules are declarative selectors (SDK 1.81): a rule matches
// on name / domain / axes, not on a predicate over the spec. A bare string in a
// selector is read as a REGEX, so every matcher below is spelled out.
const regex = (value: string) => ({ type: "regex" as const, value });

const EXACT_LABEL = exact("pl7.app/label");
const CONVERGENCE_FAMILY = regex("^pl7\\.app/vdj/convergence/");
const MATCH_ANY = regex(".*");
// Visibility rules are built from the columns ACTUALLY PRESENT in the table,
// never speculatively. The SDK's rule evaluator discards the ENTIRE rule set
// when any single rule matches zero columns (`evaluateRules`: `if
// (hitIds.length === 0) return result;`), so one rule aimed at something
// absent silently drops every column back to its own annotation — which is how
// upstream MiXCR columns ended up default-visible in a table that only wants
// its convergence family shown.
type ChainTag = { key: string; value: string };

/** Chain-domain tags of the chains that carry full-STAR. SC columns carry the
 *  scClonotypeChain letter, bulk columns the chain name (workflow convDomain). */
function fullStarChainTags(args: BlockArgs): ChainTag[] {
  const tags: ChainTag[] = [];
  if (args.hasPgenHeavy === true) {
    if (args.chainHScLetter !== undefined) {
      tags.push({ key: "pl7.app/vdj/scClonotypeChain", value: args.chainHScLetter });
    } else if (args.chainHName !== undefined) {
      tags.push({ key: "pl7.app/vdj/chain", value: args.chainHName });
    }
  }
  if (args.hasPgenLight === true) {
    if (args.chainLScLetter !== undefined) {
      tags.push({ key: "pl7.app/vdj/scClonotypeChain", value: args.chainLScLetter });
    } else if (args.chainLName !== undefined) {
      tags.push({ key: "pl7.app/vdj/chain", value: args.chainLName });
    }
  }
  return tags;
}

/**
 * Table visibility for this block's tables:
 *  - a chain that has full-STAR demotes its fast-STAR trio to OPTIONAL (still
 *    listed in Manage Columns) so full-STAR is the foregrounded signal;
 *  - the convergence family and the clone-id label stay DEFAULT;
 *  - everything enrichment dragged in from the pool starts OPTIONAL;
 *  - `perSampleOnly` additionally HIDES columns keyed on sampleId alone (the
 *    per-sample table pins one sample, so they'd repeat one value per row).
 * Each rule is emitted only when the table really contains a column it matches.
 */
function visibilityRules(
  args: BlockArgs,
  specs: PColumnSpec[],
  opts: { perSampleOnly?: boolean } = {},
): ColumnVisibilityRule[] {
  if (specs.length === 0) return [];
  const rules: ColumnVisibilityRule[] = [];

  const isFastStar = (s: PColumnSpec) => FAST_STAR_COLUMN_NAMES.includes(s.name);
  const inChain = (s: PColumnSpec, t: ChainTag) => s.domain?.[t.key] === t.value;
  const demoted = fullStarChainTags(args).filter((t) =>
    specs.some((s) => isFastStar(s) && inChain(s, t)),
  );
  if (demoted.length > 0) {
    rules.push({
      match: demoted.map((t) => ({
        name: FAST_STAR_COLUMN_NAMES.map(exact),
        domain: { [t.key]: [exact(t.value)] },
      })),
      visibility: "optional",
    });
  }

  if (opts.perSampleOnly) {
    const perSampleOnly = (s: PColumnSpec) =>
      s.axesSpec.length === 1 && s.axesSpec[0]?.name === "pl7.app/sampleId";
    if (specs.some(perSampleOnly)) {
      rules.push({
        match: {
          axes: [{ name: [exact("pl7.app/sampleId")] }],
          partialAxesMatch: false,
        },
        visibility: "hidden",
      });
    }
  }

  const keepsDefault = (s: PColumnSpec) =>
    s.name === "pl7.app/label" || s.name.startsWith("pl7.app/vdj/convergence/");
  if (specs.some(keepsDefault)) {
    rules.push({
      match: [{ name: [EXACT_LABEL] }, { name: [CONVERGENCE_FAMILY] }],
      visibility: "default",
    });
  }

  rules.push({ match: { name: [MATCH_ANY] }, visibility: "optional" });
  return rules;
}

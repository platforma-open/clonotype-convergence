import type {
  InferOutputsType,
  PColumnSpec,
  PFrameHandle,
  PlRef,
  RenderCtxBase,
} from "@platforma-sdk/model";
import { BlockModelV3, createPFrameForGraphs, createPlDataTableV3 } from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import { blockDataModel } from "./dataModel";
import type { BlockArgs, BlockData, UpstreamFacts } from "./types";

export type { BlockArgs, BlockData, UpstreamFacts };
export { blockDataModel } from "./dataModel";

// Datasets the dropdown offers — anchors on the clonotype-keyed axes
// (R10). Single-cell variant uses scClonotypeKey instead of clonotypeKey.
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

// Short human-readable subtitle showing the picked chain(s) and their
// thresholds — shown in the project block list (via `.subtitle()`) AND
// over the table in PlBlockPage (via the page's `subtitleText` output).
// Returns undefined until enough is picked to be meaningful so callers
// can fall back to a placeholder; `.subtitle()` coerces to "" because
// the SDK type insists on a non-undefined string.
function formatSubtitle(data: BlockData): string | undefined {
  const heavyChain = data.inputDerivedFacts?.chains[0];
  if (heavyChain === undefined || data.threshold === undefined) return undefined;
  const friendly = (chain: string) => {
    if (chain === "IGHeavy") return "Heavy";
    if (chain === "IGLight") return "Light";
    return chain;
  };
  const heavyPart = `${friendly(heavyChain)} ${data.threshold}`;
  if (data.lightChainPick !== undefined && data.thresholdL !== undefined) {
    return `${heavyPart} / ${friendly(data.lightChainPick)} ${data.thresholdL}`;
  }
  return heavyPart;
}

// MiXCR's chain DOMAIN values (used in `domain["pl7.app/vdj/chain"]` on
// column/axis specs — what we filter against): IGHeavy, IGLight,
// TCRAlpha, TCRBeta, TCRGamma, TCRDelta. From `chainInfos` keys in
// mixcr-clonotyping/workflow/src/process.tpl.tengo.
//
// MiXCR also exposes a `topChains` per-clonotype VALUE column whose
// values are "IGH"/"IGK"/"IGL"/"TRA"/... — those are the codes from the
// `pl7.app/discreteValues` annotation, used for filtering ROWS, not for
// tagging which chain a column belongs to. Spec R28 was based on the
// second namespace and is wrong for our domain queries.

/**
 * Walk the siblings of `ref` on its shared axes and aggregate facts:
 * which chains appear and whether the required CDR3 + abundance siblings
 * are present anywhere among them. Used both by the live `upstreamFacts`
 * output (UI mirror, R9) and by the UI's snapshot writer (R8) — same
 * shape, evaluated on every render against the current pool.
 */
function discoverUpstreamFacts<A, U>(
  ctx: RenderCtxBase<A, U>,
  ref: PlRef,
): UpstreamFacts | undefined {
  // Bail when the ref no longer resolves in the pool — the picked
  // input may have been removed, moved below this block, or invalidated
  // by an upstream rerun. The dropdown's own "value not in options"
  // hint covers the UX side; we just avoid querying a stale ref.
  if (!ctx.resultPool.getPColumnSpecByRef(ref)) return undefined;
  // MiXCR partitions its outputs across two axis frames:
  //  - per-(sample, clonotype): abundance columns (axes = [sampleId, clonotypeKey])
  //  - per-clonotype:          CDR3 sequence + V/J + per-clonotype fields (axes = [clonotypeKey])
  // The anchored selector matches axes exactly, so we need both queries.
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
  let hasAaCDR3 = false;
  let hasNtCDR3 = false;
  let hasAbundance = false;

  for (const col of [...perSampleClonotype, ...perClonotype]) {
    const spec = col.spec;
    // Chain lives on column domain (abundance/CDR3 sequence on MiXCR's
    // per-sample table) OR on the clonotype-key axis domain. Try both
    // axes — for the per-clonotype frame the axis is at index 0.
    const chain =
      spec.domain?.["pl7.app/vdj/chain"] ??
      spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"] ??
      spec.axesSpec[0]?.domain?.["pl7.app/vdj/chain"];
    if (chain) chains.add(chain);

    if (spec.name === "pl7.app/vdj/sequence" && spec.domain?.["pl7.app/vdj/feature"] === "CDR3") {
      const alphabet = spec.domain["pl7.app/alphabet"];
      if (alphabet === "aminoacid") hasAaCDR3 = true;
      if (alphabet === "nucleotide") hasNtCDR3 = true;
    }
    if (spec.annotations?.["pl7.app/isAbundance"] === "true") {
      hasAbundance = true;
    }
  }

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3,
    hasNtCDR3,
    hasAbundance,
  };
}

export const platforma = BlockModelV3.create(blockDataModel)
  .args((data): BlockArgs => {
    if (!data.inputRef) throw new Error("Input dataset is required");
    if (!data.inputDerivedFacts) {
      throw new Error("Input snapshot missing — re-select the input dataset");
    }
    const facts = data.inputDerivedFacts;

    // The dropdown is filtered to IGHeavy anchors, so the picked ref is
    // the dataset's heavy-chain entry. The checks below are a safety net
    // for stale snapshots (upstream changed after the user picked).
    if (facts.chains.length === 0) {
      throw new Error("Selected input has no detectable chain — re-select an input");
    }
    if (facts.chains.length > 1) {
      throw new Error(
        `Selected input spans multiple chains (${facts.chains.join(", ")}); ` +
          "expected a single chain per anchor",
      );
    }

    const chain = facts.chains[0];
    if (chain !== "IGHeavy") {
      throw new Error(
        `Selected input chain is "${chain}", not IGHeavy. ` +
          "Pick the IG Heavy anchor — light-chain processing lands in Phase 7.",
      );
    }

    if (!facts.hasAaCDR3) throw new Error("Selected input has no aa CDR3 column");
    if (!facts.hasNtCDR3) throw new Error("Selected input has no nt CDR3 column");
    if (!facts.hasAbundance) throw new Error("Selected input has no abundance column");

    // Light chain — projected only when both the picker is set AND the
    // matching anchor was snapshotted alongside it (the picker handler
    // writes both in one gesture; if either is missing we skip LC).
    if (data.threshold === undefined) {
      throw new Error("Heavy-chain threshold is required");
    }
    if (data.nMin === undefined) {
      throw new Error("Minimum unique CDR3 per sample is required");
    }

    const lcPick = data.lightChainPick;
    const lcRef = data.lightChainRef;
    let lcProjected: { lightChainRef: PlRef; lightChainName: string; thresholdL: number } | {} = {};
    if (lcPick !== undefined && lcRef !== undefined) {
      if (data.thresholdL === undefined) {
        throw new Error("Light-chain threshold is required");
      }
      lcProjected = {
        lightChainRef: lcRef,
        lightChainName: lcPick,
        thresholdL: data.thresholdL,
      };
    }

    return {
      inputRef: data.inputRef,
      inputDerivedFacts: facts,
      chain,
      threshold: data.threshold,
      nMin: data.nMin,
      ...lcProjected,
    };
  })

  // Dropdown candidates: one option per BCR mixcr-clonotyping run, via
  // its IGHeavy anchor (always present in a BCR run, so it's a sound
  // run identifier). The user picks a "dataset" — what they get is the
  // heavy-chain entry for that dataset's clonotyping run.
  //
  // Phase 7 will discover IGLight siblings on the same clonotypingRunId
  // (different axes, different chain domain) when a light-chain picker
  // is added — multi-chain processing from one user pick.
  //
  // TCR and any non-IGHeavy chain are hidden here; args lambda is the
  // final gate. Multi-run label disambiguation is deferred — auto-labels
  // suffice for single-dataset projects.
  .output("datasetOptions", (ctx) => {
    const broad = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    return broad.filter((opt) => {
      const spec = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      if (!spec) return false;
      const chain =
        spec.domain?.["pl7.app/vdj/chain"] ?? spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
      return chain === "IGHeavy";
    });
  })

  // Live facts about the currently picked ref — feeds the UI's
  // `PlAlert` mirror (R9). Re-derives each render so a stale snapshot
  // surfaces a fresh mismatch banner without waiting for the user to
  // re-touch the dropdown.
  .output("upstreamFacts", (ctx) => {
    if (!ctx.data.inputRef) return undefined;
    return discoverUpstreamFacts(ctx, ctx.data.inputRef);
  })

  // Light-chain options — anchors from the same clonotyping run as the
  // picked heavy anchor, with a non-IGHeavy BCR chain (typically
  // "IGLight" when MiXCR groups κ+λ together). Surfaced as a
  // { chain → PlRef } map so the picker's snapshot writer can store
  // both `data.lightChainPick` and `data.lightChainRef` in one gesture.
  // R18.
  .output("lightChainOptions", (ctx) => {
    if (!ctx.data.inputRef) return undefined;
    const heavySpec = ctx.resultPool.getPColumnSpecByRef(ctx.data.inputRef);
    if (!heavySpec) return undefined;
    const runId = heavySpec.axesSpec[1]?.domain?.["pl7.app/vdj/clonotypingRunId"];
    if (!runId) return undefined;
    const broad = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    // Carry the auto-derived label alongside the ref + chain string so
    // the UI dropdown can reuse the same labels users see in the input
    // dataset picker (e.g. "IG Light") rather than re-inventing them.
    const result: { ref: PlRef; label: string; chain: string }[] = [];
    for (const opt of broad) {
      const spec = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      if (!spec) continue;
      const optRunId = spec.axesSpec[1]?.domain?.["pl7.app/vdj/clonotypingRunId"];
      const optChain = spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
      if (optRunId !== runId) continue;
      if (!optChain || optChain === "IGHeavy") continue;
      if (optChain.startsWith("TCR")) continue;
      result.push({ ref: opt.ref, label: opt.label, chain: optChain });
    }
    return result;
  })

  // Parallel map keyed by canonical(PlRef) → UpstreamFacts for every
  // candidate dropdown option. The UI dropdown's user-gesture handler
  // reads this to write `data.inputRef` and `data.inputDerivedFacts`
  // in the same tick — the snapshot pattern from model.md, no
  // watcher-driven hairpin (R8).
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

  // Single log handle from Stage 1 — the bulk of per-sample info (drops,
  // unique counts, warnings). R45.
  //
  // Stage 2's stdout (threshold + hit count + elapsed) isn't surfaced;
  // the same facts are visible in the table directly. If a multi-step
  // log view is needed later, switch to peptide-extraction's
  // pcolumn.resourceMapBuilder pattern (one log per step keyed by name).
  //
  // retentiveOutput keeps the last stable handle visible during
  // re-derivations so PlLogView doesn't blink between empty and
  // populated.
  .retentiveOutput("runLogs", (ctx) => ctx.outputs?.resolve("stage1Logs")?.getLogHandle())

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  // Page-header subtitle: same derivation as `.subtitle()` for the
  // project block list, but exposed as an output so pages can bind it
  // via `<PlBlockPage :subtitle="...">`. Returns undefined when not yet
  // computable so the page can omit the line entirely.
  .output("subtitleText", (ctx) => formatSubtitle(ctx.data))

  // Histogram p-frame for the heavy-chain page (Phase 6). Wraps the
  // workflow's convergencePf via createPFrameForGraphs so GraphMaker
  // can consume it. PFrame handles must use outputWithStatus, NOT
  // retentiveOutput — retentive is incompatible with PFrameHandle.
  // R50 — outputWithStatus on histogram p-frames.
  .outputWithStatus("histogramPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs?.resolve("convergencePf")?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPFrameForGraphs(ctx, pCols);
  })

  // Column specs for GraphMaker's PredefinedGraphOption defaults.
  // The heavy-chain histogram page picks the nbFreq column by name.
  .output("histogramPfPcols", (ctx) => {
    const pCols = ctx.outputs?.resolve("convergencePf")?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({
      columnId: c.id,
      spec: c.spec,
    }));
  })

  // Hit-count stats for the heavy-chain histogram badge (R49). The
  // workflow's Stage 2 (apply_threshold.py) writes a small JSON
  // sidecar with {above, total}; we read it as a JSON resource here.
  // PColumn row data imported via xsv.importFile lives as a binary
  // backend resource and is not reachable from the model layer, so
  // counting can't happen here — it has to be computed workflow-side.
  // Reflects the last-run threshold (same as the histogram's dashed
  // line).
  .output("heavyHitStats", (ctx) =>
    ctx.outputs?.resolve("heavyHitStats")?.getDataAsJson<{ above: number; total: number }>(),
  )

  // Light-chain histogram outputs (Phase 7). Mirror the heavy-chain
  // pair — `lightConvergencePf` is emitted by the workflow only when
  // args.lightChainRef was set.
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
    return pCols.map((c) => ({
      columnId: c.id,
      spec: c.spec,
    }));
  })

  // Mirror of heavyHitStats for the LC histogram page. Returns
  // undefined when LC isn't enabled (`lightHitStats` workflow output
  // is conditionally emitted only when args.lightChainRef is set).
  .output("lightHitStats", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "lightHitStats",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getDataAsJson<{ above: number; total: number }>(),
  )

  // Main page table (R52). Anchored discovery from `data.inputRef`;
  // non-convergence columns hidden by default — convergence outputs
  // already carry "default"/"optional" in their pcolumn annotations
  // (R52, pcolumn-schema.md).
  //
  // `withStatus` lets PlAgDataTableV2 render its own loading/error UI
  // by consuming the OutputWithStatus<T> wrapper directly. The "absent
  // cells" flicker mid-run is a known quirk — `retentive: true` would
  // normally suppress it, but enabling retentive on this output causes
  // the table to get stuck in "no previous stable value" perpetually;
  // root cause TBD (likely a SDK interaction with anchored discovery).
  // Phase 6 / a SDK update can revisit.
  // Light-chain table — mirrors mainTable but anchored on the LC ref.
  // Heavy and LC convergence columns live on DIFFERENT clonotypeKey
  // axes (different chain domain on the axis), so they can't share one
  // anchored table — each chain gets its own. Visible only on the
  // Light chain page.
  .outputWithStatus("lightMainTable", (ctx) => {
    const lightRef = (ctx.activeArgs as BlockArgs | undefined)?.lightChainRef;
    if (!lightRef) return undefined;
    // Same full-readiness gate as mainTable — avoid mid-run partial
    // rows with "absent" cells.
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
    // Guard against the upstream becoming unreachable (e.g. the user
    // moved this block above its source in the project order).
    // createPlDataTableV3 would otherwise throw an unresolvable-anchor
    // error; returning undefined keeps the not-ready overlay instead.
    if (!ctx.resultPool.getPColumnSpecByRef(lightRef)) return undefined;
    // Anchor on our own LC fastStar column — see mainTable for why.
    const lightPcols = ctx.outputs
      ?.resolve({
        field: "lightConvergencePf",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getPColumns();
    const lightFastStarSpec = lightPcols?.find(
      (c) => c.spec.name === "pl7.app/vdj/convergence/fastStar",
    )?.spec;
    if (!lightFastStarSpec) return undefined;
    return createPlDataTableV3(ctx, {
      columns: {
        anchors: { main: lightFastStarSpec },
        selector: { mode: "enrichment" },
      },
      tableState: ctx.data.lightMainTableState,
      displayOptions: {
        visibility: [
          // Same discoverable-but-hidden policy as mainTable.
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

  .outputWithStatus("mainTable", (ctx) => {
    if (!ctx.data.inputRef) return undefined;
    // Gate on full workflow readiness so the table doesn't show
    // mid-pipeline partial PFrames where some sample rows have
    // convergence values and others render as "absent" cells. With
    // the gate, the table stays in its `loading-text="Running"` state
    // until the whole run is done; trade-off is no incremental view.
    if (ctx.outputs?.getIsReadyOrError() !== true) return undefined;
    // Guard against the upstream becoming unreachable (block moved
    // above its source) — createPlDataTableV3 would throw an
    // unresolvable-anchor error.
    if (!ctx.resultPool.getPColumnSpecByRef(ctx.data.inputRef)) return undefined;
    // Anchor on our own fastStar column (not the upstream inputRef) so
    // table rows = the clonotype set Stage 1 produced. Rows dropped
    // upstream (null CDR3, sub-nMin samples) don't appear at all
    // rather than rendering as empty cells. Upstream columns the user
    // opts in via the column picker are joined onto our axis space —
    // same axis shape ([sampleId, clonotypeKey], chain=IGHeavy), just
    // a subset of keys.
    const heavyPcols = ctx.outputs?.resolve("convergencePf")?.getPColumns();
    const fastStarSpec = heavyPcols?.find(
      (c) => c.spec.name === "pl7.app/vdj/convergence/fastStar",
    )?.spec;
    if (!fastStarSpec) return undefined;
    return createPlDataTableV3(ctx, {
      columns: {
        anchors: { main: fastStarSpec },
        selector: { mode: "enrichment" },
      },
      tableState: ctx.data.mainTableState,
      displayOptions: {
        visibility: [
          // Discoverable-but-hidden experience (R52): upstream MiXCR
          // and sibling-block columns sit in the column-visibility
          // panel unchecked. The user can opt them in via the panel.
          // Pattern mirrored from titeseq-analysis. Visible by default
          // (not matched here): axis-label columns (sample / clonotype
          // keys), and the block's own convergence outputs.
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

  .sections((ctx) => {
    const showHeavy = ctx.data.inputRef !== undefined && ctx.activeArgs !== undefined;
    // Light-chain sections appear once a run with LC enabled has
    // completed. activeArgs.lightChainRef being present is the cleanest
    // gate — `data` may have the picker set ahead of the next run.
    const showLight =
      showHeavy &&
      ctx.activeArgs !== undefined &&
      (ctx.activeArgs as BlockArgs).lightChainRef !== undefined;
    return [
      // Heavy: table on the entry route, histogram on its own page.
      { type: "link" as const, href: "/" as const, label: "Heavy clonotype table" },
      ...(showHeavy
        ? [
            {
              type: "link" as const,
              href: "/convergence/heavy" as const,
              label: "Heavy frequency distribution",
            },
          ]
        : []),
      // Light: same shape, conditional.
      ...(showLight
        ? [
            {
              type: "link" as const,
              href: "/convergence/light/table" as const,
              label: "Light clonotype table",
            },
            {
              type: "link" as const,
              href: "/convergence/light" as const,
              label: "Light frequency distribution",
            },
          ]
        : []),
    ];
  })

  .title(() => "Clonotype Convergence")

  // Subtitle shows the selected chains and their thresholds so the
  // project view distinguishes parallel runs of this block (different
  // datasets, different LC picks, different cutoffs) at a glance.
  // Built from `data` so it stays live as the user edits settings —
  // doesn't wait for the next run.
  .subtitle((ctx) => ctx.data.customBlockLabel || formatSubtitle(ctx.data) || "")

  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;

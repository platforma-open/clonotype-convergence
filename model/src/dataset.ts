import type {
  ColumnUniversalId,
  DatasetOption,
  DatasetSelection,
  PColumnSpec,
  PlRef,
  RelaxedColumnSelector,
  RenderCtxBase,
} from "@platforma-sdk/model";
import {
  buildDatasetOptions,
  createDatasetSelection,
  createPrimaryRef,
  deriveColumnOptions,
  isPColumnSpec,
  isPlRef,
  parseColumnIdSafely,
} from "@platforma-sdk/model";
import { SC_AXIS, SC_BCR_RECEPTOR, isHeavy, isLight } from "./chains";
import { exact, resultPool, toColumnId } from "./columns";

/** The dataset and the subset it is restricted to, as the block stores them. */
export type DatasetPick = {
  datasetRef: ColumnUniversalId | undefined;
  filterRef: ColumnUniversalId | undefined;
};

/**
 * Result-pool ids of the clonotype-keyed anchors of upstream blocks that the
 * dataset picker can offer: bulk (`pl7.app/vdj/clonotypeKey`) or single-cell
 * (`pl7.app/vdj/scClonotypeKey`) clonotypes per sample.
 */
export function getDatasetCandidates(ctx: RenderCtxBase): ColumnUniversalId[] {
  return getAnchorColumns(ctx).getColumnIds();
}

/**
 * The dataset picker's options: every B-cell receptor anchor, each with its
 * subset columns (`pl7.app/isSubset`, e.g. repertoire-labeling labels or Lead
 * Selection picks) as filters.
 *
 * Two anchor shapes are accepted:
 *   - Bulk anchors (clonotypeKey axis): chain identity lives on the
 *     axis domain. Accept IGHeavy / IGLight / IGKappa / IGLambda;
 *     reject TCR* and anything else.
 *   - SC anchors (scClonotypeKey axis): chain lives on column
 *     domain (scClonotypeChain), so the axis has `receptor` instead.
 *     Accept receptor == "IG" (BCR — both chains hang off the same
 *     anchor); reject receptor == "TCRAB" / "TCRGD".
 * Mode (bulk vs SC) is detected post-selection by inspecting the
 * axis name on the picked spec.
 *
 * `selected` stays an option unconditionally. Otherwise, when post-run pool
 * churn briefly fails its chain check, it drops out of the options and the
 * `required` picker reconciles to another dataset — clobbering the dataset
 * snapshot (the transient IG-Heavy → IG-Light flip with a spurious "no BCR
 * chain" alert, healing when the pool settles). The check only needs to stop
 * a *new* pick of an unusable dataset, not destabilise an existing one.
 */
export function getDatasetOptions(
  ctx: RenderCtxBase,
  selected: ColumnUniversalId | undefined,
): DatasetOption[] {
  // Only the filters are taken from here: the datasets below are matched to
  // them by column id.
  const withFilters =
    buildDatasetOptions(ctx, {
      primary: (spec) =>
        isPColumnSpec(spec) &&
        spec.annotations?.["pl7.app/isAnchor"] === "true" &&
        spec.axesSpec.length === 2 &&
        spec.axesSpec[0].name === "pl7.app/sampleId" &&
        DATASET_KEY_AXES.has(spec.axesSpec[1].name),
      // Only subsets keyed by the clonotype axis alone.
      filter: (spec) =>
        isPColumnSpec(spec) &&
        spec.axesSpec.length === 1 &&
        DATASET_KEY_AXES.has(spec.axesSpec[0].name),
      requireEnrichments: false,
    }) ?? [];

  // Exclude scFv constructs (engineered single-chain VH-linker-VL): out of
  // scope for repertoire convergence (in-vivo only), and they'd otherwise
  // pass as SC-paired IG. `pl7.app/vdj/scFv-sequence` is the platform's scFv
  // marker (clonotype-clustering / -space / sequence-embeddings key off it
  // too); the scClonotypeKey/structure domain is an unfinished placeholder
  // shared with paired SC, so it can't discriminate. The marker is looked up
  // by name alone across the whole result pool.
  const poolHasScFv = !resultPool(ctx)
    .filter({ include: { name: [exact(SCFV_MARKER)] } })
    .isEmpty();

  // NO CDR3-readiness check here, deliberately — the equivalent check lives
  // in the args lambda instead. Hiding is the wrong response to an unusable
  // dataset: it is indistinguishable from the block not seeing it at all. So
  // the picker offers every BCR anchor, and args refuses to build (Run
  // disabled, with a reason) when the snapshot says the columns aren't there.
  const anchors = getAnchorColumns(ctx);
  const specs = new Map(anchors.getColumns().map((column) => [column.id, column.getSpec()]));
  const options: DatasetOption[] = [];
  for (const { id, label } of deriveColumnOptions(anchors)) {
    const ref = toPlRef(id);
    if (ref === undefined) continue;
    if (id !== selected && (poolHasScFv || !isBcrAnchor(specs.get(id)))) continue;
    const primary = { ref, label };
    const filters = withFilters.find((o) => toColumnId(o.primary.ref) === id)?.filters;
    options.push(filters === undefined ? { primary } : { primary, filters });
  }
  return options;
}

/** The dataset picker's selection of the stored dataset and subset. */
export function toDatasetSelection(pick: DatasetPick): DatasetSelection | undefined {
  const column = pick.datasetRef === undefined ? undefined : toPlRef(pick.datasetRef);
  if (column === undefined) return undefined;
  const filter = pick.filterRef === undefined ? undefined : toPlRef(pick.filterRef);
  return createDatasetSelection(createPrimaryRef(column, filter));
}

/** The dataset and subset a dataset picker selection stores. */
export function fromDatasetSelection(selection: DatasetSelection | undefined): DatasetPick {
  const primary = selection?.primary;
  return {
    datasetRef: primary === undefined ? undefined : toColumnId(primary.column),
    filterRef: primary?.filter === undefined ? undefined : toColumnId(primary.filter),
  };
}

// Internals

const SCFV_MARKER = "pl7.app/vdj/scFv-sequence";

const ANCHOR_ANNOTATIONS: RelaxedColumnSelector["annotations"] = {
  "pl7.app/isAnchor": [exact("true")],
};

/** Key axes of the datasets this block accepts: bulk and single-cell clonotypes. */
const DATASET_KEY_AXES: ReadonlySet<string> = new Set(["pl7.app/vdj/clonotypeKey", SC_AXIS]);

const DATASET_ANCHORS: RelaxedColumnSelector[] = [...DATASET_KEY_AXES].map((clonotypeAxis) => ({
  axes: [{ name: [exact("pl7.app/sampleId")] }, { name: [exact(clonotypeAxis)] }],
  partialAxesMatch: false,
  annotations: ANCHOR_ANNOTATIONS,
}));

function getAnchorColumns(ctx: RenderCtxBase) {
  return resultPool(ctx).filter({ include: DATASET_ANCHORS });
}

/** Whether the anchor's clonotypes are of a B-cell receptor chain. */
function isBcrAnchor(spec: PColumnSpec | undefined): boolean {
  if (spec === undefined) return false;
  const cloneAxis = spec.axesSpec[1];
  if (cloneAxis?.name === SC_AXIS) {
    return cloneAxis.domain?.["pl7.app/vdj/receptor"] === SC_BCR_RECEPTOR;
  }
  // Bulk path: chain in axis or column domain.
  const chain = spec.domain?.["pl7.app/vdj/chain"] ?? cloneAxis?.domain?.["pl7.app/vdj/chain"];
  return chain !== undefined && !chain.startsWith("TCR") && (isHeavy(chain) || isLight(chain));
}

/** The upstream output a result-pool id names, as the ref the dataset picker works with. */
function toPlRef(id: ColumnUniversalId): PlRef | undefined {
  const key = parseColumnIdSafely(id);
  return isPlRef(key) ? key : undefined;
}

import { assertParamsObject, defineBlockKind } from "@platforma-sdk/block-kind";
import type { ColumnUniversalId, ColumnValueId } from "@platforma-sdk/model";
import { isColumnUniversalId, isColumnValueId } from "@platforma-sdk/model";
import { name, version } from "../package.json" with { type: "json" };

/**
 * This block's init-params contract — everything a user sets by hand: the
 * dataset pick, the light-chain opt-in, and every analysis knob in the
 * Advanced settings.
 *
 * Left out: `datasetFacts` and `datasetLabel`, which the picker derives from
 * the chosen dataset (and which `app.ts` keeps refreshing from the block's own
 * outputs), and the table / chart view state.
 *
 * Because the facts snapshot is derived rather than templated, a block seeded
 * from params holds `datasetRef` without facts until the UI recomputes them --
 * the same state the UI itself passes through between picking a dataset and the
 * facts landing.
 *
 * Columns are result-pool column ids, each naming the block that produced the
 * column. The expected values are column value ids of the expected-filter
 * column: each names the column it was picked from, and through it the block
 * that produced the value.
 *
 * Every field is optional: the projection hands live state back untouched, and
 * a half-configured block is ordinary state the UI reaches. Requiring one would
 * make the block export a file its own kind refuses to apply, so export and
 * apply would stop being inverses.
 */
export type BlockParams = {
  datasetRef?: ColumnUniversalId;
  filterRef?: ColumnUniversalId;
  processLightChain?: boolean;
  thresholdH?: number;
  thresholdL?: number;
  nMin?: number;
  alpha?: number;
  applyClusterFilter?: boolean;
  clusterMin?: number;
  expectedFilterRef?: ColumnUniversalId;
  expectedValues?: ColumnValueId[];
  groupingRef?: ColumnUniversalId;
  customBlockLabel?: string;
};

/** The same contract at runtime, for params arriving from a template file rather than typed code. */
function parseInitializationParams(value: unknown): BlockParams {
  assertParamsObject(value);

  const {
    datasetRef,
    filterRef,
    processLightChain,
    thresholdH,
    thresholdL,
    nMin,
    alpha,
    applyClusterFilter,
    clusterMin,
    expectedFilterRef,
    expectedValues,
    groupingRef,
    customBlockLabel,
  } = value;

  assertOptionalColumn(datasetRef, "datasetRef");
  assertOptionalColumn(filterRef, "filterRef");
  assertOptionalColumn(expectedFilterRef, "expectedFilterRef");
  assertOptionalColumn(groupingRef, "groupingRef");

  assertOptionalBoolean(processLightChain, "processLightChain");
  assertOptionalBoolean(applyClusterFilter, "applyClusterFilter");

  assertOptionalNumber(thresholdH, "thresholdH");
  assertOptionalNumber(thresholdL, "thresholdL");
  assertOptionalNumber(nMin, "nMin");
  assertOptionalNumber(alpha, "alpha");
  assertOptionalNumber(clusterMin, "clusterMin");

  // The expected values are values of the expected-filter column, so any value
  // the user's metadata holds is legal -- only the column value id form is
  // checked. A value the column no longer holds stays picked and is shown as
  // not available.
  if (
    expectedValues !== undefined &&
    (!Array.isArray(expectedValues) || !expectedValues.every(isColumnValueId))
  ) {
    throw new Error(
      "'expectedValues' must be an array of column values, written as column value ids.",
    );
  }
  if (customBlockLabel !== undefined && typeof customBlockLabel !== "string") {
    throw new Error("'customBlockLabel' must be a string.");
  }

  return {
    datasetRef,
    filterRef,
    processLightChain,
    thresholdH,
    thresholdL,
    nMin,
    alpha,
    applyClusterFilter,
    clusterMin,
    expectedFilterRef,
    expectedValues,
    groupingRef,
    customBlockLabel,
  };
}

// `isColumnUniversalId` is the SDK's own guard, so a column is recognized the
// same way here as everywhere else. Ids are placeholders during the pre-flight
// check that runs before any block exists, so shape is all that can be checked.
function assertOptionalColumn(
  value: unknown,
  field: string,
): asserts value is ColumnUniversalId | undefined {
  if (value !== undefined && !isColumnUniversalId(value)) {
    throw new Error(`'${field}' must be an upstream column, written as a column id.`);
  }
}

function assertOptionalBoolean(
  value: unknown,
  field: string,
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`'${field}' must be a boolean.`);
  }
}

function assertOptionalNumber(value: unknown, field: string): asserts value is number | undefined {
  if (value !== undefined && typeof value !== "number") {
    throw new Error(`'${field}' must be a number.`);
  }
}

// Identity (`name`/`version`) comes from this package's own `package.json`, so
// the on-wire `{name}@{version}` reference can never drift from what npm
// publishes; the bundler inlines the JSON import.
export const kind = defineBlockKind<BlockParams>({ name, version, parseInitializationParams });

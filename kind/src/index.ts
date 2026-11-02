import { assertParamsObject, defineBlockKind } from "@platforma-sdk/block-kind";
import type { PlRef } from "@platforma-sdk/model";
import { isPlRef } from "@platforma-sdk/model";
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
 * Every field is optional: the projection hands live state back untouched, and
 * a half-configured block is ordinary state the UI reaches. Requiring one would
 * make the block export a file its own kind refuses to apply, so export and
 * apply would stop being inverses.
 */
export type BlockParams = {
  datasetRef?: PlRef;
  filterRef?: PlRef;
  processLightChain?: boolean;
  thresholdH?: number;
  thresholdL?: number;
  nMin?: number;
  alpha?: number;
  applyClusterFilter?: boolean;
  clusterMin?: number;
  expectedFilterRef?: PlRef;
  expectedValues?: string[];
  groupingRef?: PlRef;
  isotypeValues?: string[];
  perIsotype?: boolean;
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
    isotypeValues,
    perIsotype,
    customBlockLabel,
  } = value;

  assertOptionalPlRef(datasetRef, "datasetRef");
  assertOptionalPlRef(filterRef, "filterRef");
  assertOptionalPlRef(expectedFilterRef, "expectedFilterRef");
  assertOptionalPlRef(groupingRef, "groupingRef");

  assertOptionalBoolean(processLightChain, "processLightChain");
  assertOptionalBoolean(applyClusterFilter, "applyClusterFilter");
  assertOptionalBoolean(perIsotype, "perIsotype");

  assertOptionalNumber(thresholdH, "thresholdH");
  assertOptionalNumber(thresholdL, "thresholdL");
  assertOptionalNumber(nMin, "nMin");
  assertOptionalNumber(alpha, "alpha");
  assertOptionalNumber(clusterMin, "clusterMin");

  assertOptionalStringArray(expectedValues, "expectedValues");
  assertOptionalStringArray(isotypeValues, "isotypeValues");
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
    isotypeValues,
    perIsotype,
    customBlockLabel,
  };
}

function assertOptionalPlRef(value: unknown, field: string): asserts value is PlRef | undefined {
  if (value !== undefined && !isPlRef(value)) {
    throw new Error(
      `'${field}' must be a reference to an upstream column, written as { block, name }.`,
    );
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

function assertOptionalStringArray(
  value: unknown,
  field: string,
): asserts value is string[] | undefined {
  if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) {
    throw new Error(`'${field}' must be an array of strings.`);
  }
}

// Identity (`name`/`version`) comes from this package's own `package.json`, so
// the on-wire `{name}@{version}` reference can never drift from what npm
// publishes; the bundler inlines the JSON import.
export const kind = defineBlockKind<BlockParams>({ name, version, parseInitializationParams });

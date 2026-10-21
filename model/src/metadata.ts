import type { ColumnUniversalId, ColumnValueOption, RenderCtxBase } from "@platforma-sdk/model";
import {
  deriveColumnOptions,
  deriveColumnValueOptions,
  readColumnValues,
} from "@platforma-sdk/model";
import type { ColumnPickerOption } from "./columns";
import { exact, findColumn, resultPool } from "./columns";

/** Options of the expected-values picker: the values of the expected-filter column. */
export type ExpectedValueOptions = {
  /**
   * The expected-filter column the options were built for: they describe the picks only while it
   * stays picked.
   */
  computedFor: ColumnUniversalId;
  options: ColumnValueOption[];
};

/**
 * Sample-metadata columns (`pl7.app/metadata`) of upstream blocks, as options of the
 * expected-filter and grouping pickers.
 */
export function getMetadataOptions(ctx: RenderCtxBase): ColumnPickerOption[] {
  const columns = resultPool(ctx).filter({ include: { name: [exact(METADATA_COLUMN_NAME)] } });
  return deriveColumnOptions(columns).map(({ id, label }) => ({ value: id, label }));
}

/**
 * Values of the expected-filter column as options of the expected-values picker, each a column
 * value id naming the expected-filter column, and through it the block that produced the value.
 * `undefined` until an expected-filter column is picked. A column whose values cannot be read
 * now — still resolving, not computed, gone, or not stored inline — offers no values, so its
 * picks show as not available.
 */
export function getExpectedValueOptions(
  ctx: RenderCtxBase,
  expectedFilterRef: ColumnUniversalId | undefined,
): ExpectedValueOptions | undefined {
  if (expectedFilterRef === undefined) return undefined;
  const column = findColumn(ctx, expectedFilterRef);
  const entries = column === undefined ? undefined : readColumnValues(column);
  return { computedFor: expectedFilterRef, options: deriveColumnValueOptions(entries ?? []) };
}

// Internals

const METADATA_COLUMN_NAME = "pl7.app/metadata";

import type {
  AxisSpec,
  ColumnUniversalId,
  PColumnIdAndSpec,
  PlRef,
  RelaxedAxisSelector,
  StringMatcher,
  TreeNodeAccessor,
} from "@platforma-sdk/model";
import {
  Column,
  ColumnRecipe,
  ColumnsCollection,
  createGlobalPObjectId,
  isDataColumn,
} from "@platforma-sdk/model";

/** A column offered in a column picker, by its result-pool id. */
export type ColumnPickerOption = {
  value: ColumnUniversalId;
  label: string;
};

/** Columns of upstream blocks. */
export function resultPool(): ColumnsCollection {
  return ColumnsCollection(["result_pool"]);
}

/**
 * The column with this id, found by id alone. `undefined` while it is still resolving and once
 * it is gone: a stored id may name a column its upstream block no longer produces.
 */
export function findColumn(id: ColumnUniversalId): ColumnRecipe | undefined {
  if (ColumnRecipe.getStatus(id) !== "present") return undefined;
  return Column(id);
}

/**
 * Columns of one of this block's outputs. `undefined` until the output is there and every column
 * of it has arrived.
 */
export function getOutputColumns(
  accessor: TreeNodeAccessor | undefined,
): ColumnsCollection | undefined {
  if (accessor === undefined) return undefined;
  const collection = ColumnsCollection([accessor]);
  return collection.isFinal() ? collection : undefined;
}

/** Ids and specs of plain stored columns, as graph defaults take them. */
export function toIdsAndSpecs(columns: ColumnRecipe[]): PColumnIdAndSpec[] {
  return columns
    .filter(isDataColumn)
    .map((column) => ({ columnId: column.id, spec: column.getSpec() }));
}

/** A selector of exactly this axis: its name, type and every entry of its domain. */
export function axisSelector(axis: AxisSpec): RelaxedAxisSelector {
  const domain = Object.fromEntries(
    Object.entries(axis.domain ?? {}).map(([key, value]) => [key, [exact(value)]]),
  );
  return { name: [exact(axis.name)], type: axis.type, domain };
}

/** A matcher of exactly this string. */
export function exact(value: string): StringMatcher {
  return { type: "exact", value };
}

/** The result-pool id of the upstream output a ref points to: it names the same block and column. */
export function toColumnId(ref: PlRef): ColumnUniversalId {
  return createGlobalPObjectId(ref.blockId, ref.name);
}

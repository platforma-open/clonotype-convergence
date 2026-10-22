import { deriveColumnOptions } from "@platforma-sdk/model";
import type { ColumnPickerOption } from "./columns";
import { exact, resultPool } from "./columns";

/**
 * Sample-metadata columns (`pl7.app/metadata`) of upstream blocks, as options of the
 * expected-filter and grouping pickers.
 */
export function getMetadataOptions(): ColumnPickerOption[] {
  const columns = resultPool().filter({ include: { name: [exact(METADATA_COLUMN_NAME)] } });
  return deriveColumnOptions(columns).map(({ id, label }) => ({ value: id, label }));
}

// Internals

const METADATA_COLUMN_NAME = "pl7.app/metadata";

import type { PlRef } from "@platforma-sdk/model";
import { plRefsEqual } from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import type { useApp } from "./app";

type AppModel = ReturnType<typeof useApp>["model"];

/**
 * The dataset snapshot's two derived halves, read from the model's outputs.
 *
 * Shared by the picker (which writes the snapshot in the user's gesture) and
 * the backfill in `app.ts` (which writes it for a `datasetRef` that arrived
 * without one, from a project template). Both must read the same source, or a
 * template-seeded block would end up with a snapshot the picker would not have
 * produced.
 */
export function factsFor(model: AppModel, ref: PlRef | undefined) {
  if (!ref) return undefined;
  const key = canonicalize(ref as unknown as Record<string, unknown>);
  if (key === undefined) return undefined;
  const facts = model.outputs.factsByRef?.[key];
  // Return a copy so the persisted snapshot in `data` doesn't alias the
  // reactive outputs object.
  return facts ? { ...facts, chains: [...facts.chains] } : undefined;
}

/**
 * The picked entry's label exactly as the dropdown shows it, for the page subtitle: the
 * subset's when one is picked (its label already carries the dataset as a prefix), else the
 * dataset's.
 */
export function labelFor(
  model: AppModel,
  ref: PlRef | undefined,
  filter: PlRef | undefined,
): string | undefined {
  if (!ref) return undefined;
  const option = model.outputs.datasetOptions?.find((o) => plRefsEqual(o.primary.ref, ref, true));
  if (filter !== undefined) {
    const filterLabel = option?.filters?.find((f) => plRefsEqual(f.ref, filter, true))?.label;
    if (filterLabel !== undefined) return filterLabel;
  }
  return option?.primary.label;
}

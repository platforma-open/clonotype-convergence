import type { ColumnUniversalId } from "@platforma-sdk/model";
import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { watch } from "vue";
import { factsFor, labelFor } from "./datasetSnapshot";
import AggregatedDistributionPage from "./pages/AggregatedDistributionPage.vue";
import MainPage from "./pages/MainPage.vue";
import PerSampleDistributionPage from "./pages/PerSampleDistributionPage.vue";
import PerSamplePage from "./pages/PerSamplePage.vue";

export const sdkPlugin = defineAppV3(platforma, (app) => {
  // Build the dataset snapshot for a `datasetRef` that arrived without one.
  // Must run before syncPgenAvailability, which only refreshes an existing
  // snapshot.
  backfillDatasetSnapshot(app.model);
  // Keep the dataset snapshot's Generation Probability fields live.
  syncPgenAvailability(app.model);
  return {
    // Drives the block's green running line while the workflow computes.
    progress: () => app.model.outputs.isRunning,
    routes: {
      // "/" → the aggregated, clonotype-only table — the shape
      // downstream consumes, shown first.
      "/": () => MainPage,
      // Two selector-driven distribution charts: aggregated (the
      // exported clonotype-only scores) and per-sample. Each offers every score
      // across chain × mode via the Y-axis predicate.
      "/distribution/aggregated": () => AggregatedDistributionPage,
      "/distribution/per-sample": () => PerSampleDistributionPage,
      // Per-sample QC table (v1's internal per-sample family, sample sheet).
      "/per-sample": () => PerSamplePage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

type AppModel = ReturnType<typeof useApp>["model"];

// Automatic Generation Probability detection. The args callback is a
// pure function of `data` and can't query the result pool, so the pool-derived
// Pgen availability + refs must live in `data`. We seed them into
// `data.datasetFacts` at dataset-pick time, but gen-prob can be added, removed,
// or re-created (new blockId) afterwards — which used to leave a dead id and
// silently produce 0 hits under full-STAR. This watcher feeds the LIVE
// `pgenStatus` output (re-discovered from the current pool every render) back
// into the snapshot's Pgen fields, so a chain gains full-STAR with no re-pick.
// It is NOT a plain mirror — see the latch below: a reading that finds Pgen is
// always adopted, one that finds none only while the block is idle. Only the
// Pgen fields are touched; the stable chain/CDR3/axis facts stay as
// snapshotted. The equality guard avoids spurious writes (and the re-run they'd
// trigger) when nothing changed, and an undefined status (no dataset /
// transient churn) is ignored rather than clobbering the last good snapshot.
// No loop: `pgenStatus` derives from `datasetRef` + the pool, not from the
// fields written here.
function syncPgenAvailability(model: AppModel) {
  watch(
    () => [model.outputs.pgenStatus, model.outputs.isRunning] as const,
    ([status, isRunning]) => {
      if (!status) return;
      const facts = model.data.datasetFacts;
      if (!facts) return;

      // A "no Pgen" reading is only trusted when the block is idle.
      //
      // While the block runs, the result pool is being rebuilt around it and
      // the Pgen lookup can momentarily come back empty. Writing that reading
      // through was visible three ways: the page subtitle flipped to the
      // fast-STAR form (`thr …` instead of `alpha …`), the block went stale
      // with no setting touched (the write changes args), and — the one that
      // actually costs results — a Run committed inside that window carries
      // hasPgen=false, so full-STAR is silently skipped and the run looks
      // perfectly successful with fast-STAR-only output.
      //
      // Availability is therefore latched: it may always go UP (gen-prob added,
      // or re-created under a new blockId → adopt the fresh id), but may only
      // go DOWN while idle, when an empty lookup means gen-prob really is gone.
      // A dataset re-pick rewrites the snapshot wholesale either way, so a
      // genuine removal is never stuck behind this latch.
      // Per chain, pick the ID first, then derive the flag from it. The
      // invariant `hasPgen === (id !== undefined)` is what keeps args and the
      // workflow in agreement (facts.ts), and it must be restored on every
      // write here — the previous `{ ...facts, ...status }` spread broke it:
      // `undefined` values do not survive the model → UI boundary, so a status
      // that found nothing arrived as `{ hasPgen*: false }` with the id keys
      // ABSENT. The spread then flipped the flags and left the stale ids in
      // place, producing `hasPgenHeavy: false` next to a live pgenRefHeavy —
      // a block that holds a usable Pgen id and still runs fast-STAR only,
      // because the args lambda gates the id on the flag.
      const trustLoss = isRunning !== true;
      const pickId = (
        found: boolean,
        fresh: ColumnUniversalId | undefined,
        previous: ColumnUniversalId | undefined,
      ): ColumnUniversalId | undefined => (found ? fresh : trustLoss ? undefined : previous);
      const refHeavy = pickId(status.hasPgenHeavy, status.pgenRefHeavy, facts.pgenRefHeavy);
      const refLight = pickId(status.hasPgenLight, status.pgenRefLight, facts.pgenRefLight);
      const next = {
        pgenRefHeavy: refHeavy,
        pgenRefLight: refLight,
        hasPgenHeavy: refHeavy !== undefined,
        hasPgenLight: refLight !== undefined,
      };

      if (
        facts.hasPgenHeavy === next.hasPgenHeavy &&
        facts.hasPgenLight === next.hasPgenLight &&
        facts.pgenRefHeavy === next.pgenRefHeavy &&
        facts.pgenRefLight === next.pgenRefLight
      ) {
        return;
      }
      model.data.datasetFacts = { ...facts, ...next };
    },
    { immediate: true, deep: true },
  );
}

// A project template seeds `datasetRef` alone: `datasetFacts` and
// `datasetLabel` are derived from the pool, so the kind's init-params contract
// leaves them out and the block starts with a dataset id and no snapshot. Nothing
// else fills that gap -- `onPickDataset` treats re-picking the same dataset as a
// no-op (deliberately, so pool churn can't downgrade a good snapshot), and
// `syncPgenAvailability` returns early when there are no facts to refresh. So
// without this the seeded block stays non-runnable on "Select a dataset" until
// the user clears the picker and reselects.
//
// Reads the same two outputs the picker does, so a seeded snapshot is
// identical to a picked one. Fires at most once per dataset: the guard is
// "facts are missing", and writing them makes it false. No loop -- `factsByDataset`
// derives from `datasetRef` and the pool, never from the fields written here.
// An absent entry (options not resolved yet) is left for a later tick rather
// than written as a partial snapshot.
function backfillDatasetSnapshot(model: AppModel) {
  watch(
    () =>
      [model.data.datasetRef, model.outputs.factsByDataset, model.outputs.datasetOptions] as const,
    () => {
      const dataset = model.data.datasetRef;
      if (!dataset || model.data.datasetFacts) return;
      const facts = factsFor(model, dataset);
      if (!facts) return;
      model.data.datasetFacts = facts;
      model.data.datasetLabel ??= labelFor(model, dataset, model.data.filterRef);
    },
    { immediate: true, deep: true },
  );
}

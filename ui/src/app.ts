import type { PlRef } from "@platforma-sdk/model";
import { platforma } from "@platforma-open/milaboratories.clonotype-convergence.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { watch } from "vue";
import AggregatedDistributionPage from "./pages/AggregatedDistributionPage.vue";
import MainPage from "./pages/MainPage.vue";
import PerSampleDistributionPage from "./pages/PerSampleDistributionPage.vue";
import PerSamplePage from "./pages/PerSamplePage.vue";

export const sdkPlugin = defineAppV3(platforma, (app) => {
  // Keep the dataset snapshot's Generation Probability fields live (A-0010).
  syncPgenAvailability(app.model);
  return {
    // Drives the block's green running line while the workflow computes.
    progress: () => app.model.outputs.isRunning,
    routes: {
      // "/" → the aggregated, clonotype-only table (A-0015) — the shape
      // downstream consumes, shown first.
      "/": () => MainPage,
      // Two selector-driven distribution charts (A-0015 v2): aggregated (the
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

const sameRef = (a: PlRef | undefined, b: PlRef | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.blockId === b.blockId && a.name === b.name);

// Automatic Generation Probability detection (A-0010). The args callback is a
// pure function of `data` and can't query the result pool, so the pool-derived
// Pgen availability + refs must live in `data`. We seed them into
// `data.datasetFacts` at dataset-pick time, but gen-prob can be added, removed,
// or re-created (new blockId) afterwards — which used to leave a dead ref and
// silently produce 0 hits under full-STAR. This watcher mirrors the LIVE
// `pgenStatus` output (re-discovered from the current pool every render) back
// into the snapshot's Pgen fields whenever they drift, so args always carries
// the current ref/method with no re-pick. Only the Pgen fields are touched; the
// stable chain/CDR3/axis facts stay as snapshotted. The equality guard avoids
// spurious writes (and the re-run they'd trigger) when nothing changed, and an
// undefined status (no dataset / transient churn) is ignored rather than
// clobbering the last good snapshot. No loop: `pgenStatus` derives from
// `datasetRef` + the pool, not from the fields written here.
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
      // or re-created under a new blockId → adopt the fresh ref), but may only
      // go DOWN while idle, when an empty lookup means gen-prob really is gone.
      // A dataset re-pick rewrites the snapshot wholesale either way, so a
      // genuine removal is never stuck behind this latch.
      // Per chain, pick the REF first, then derive the flag from it. The
      // invariant `hasPgen === (ref !== undefined)` is what keeps args and the
      // workflow in agreement (facts.ts), and it must be restored on every
      // write here — the previous `{ ...facts, ...status }` spread broke it:
      // `undefined` values do not survive the model → UI boundary, so a status
      // that found nothing arrived as `{ hasPgen*: false }` with the ref keys
      // ABSENT. The spread then flipped the flags and left the stale refs in
      // place, producing `hasPgenHeavy: false` next to a live pgenRefHeavy —
      // a block that holds a usable Pgen ref and still runs fast-STAR only,
      // because the args lambda gates the ref on the flag.
      const trustLoss = isRunning !== true;
      const pickRef = (found: boolean, fresh?: PlRef, previous?: PlRef): PlRef | undefined =>
        found ? fresh : trustLoss ? undefined : previous;
      const refHeavy = pickRef(status.hasPgenHeavy, status.pgenRefHeavy, facts.pgenRefHeavy);
      const refLight = pickRef(status.hasPgenLight, status.pgenRefLight, facts.pgenRefLight);
      const next = {
        pgenRefHeavy: refHeavy,
        pgenRefLight: refLight,
        hasPgenHeavy: refHeavy !== undefined,
        hasPgenLight: refLight !== undefined,
      };

      if (
        facts.hasPgenHeavy === next.hasPgenHeavy &&
        facts.hasPgenLight === next.hasPgenLight &&
        sameRef(facts.pgenRefHeavy, next.pgenRefHeavy) &&
        sameRef(facts.pgenRefLight, next.pgenRefLight)
      ) {
        return;
      }
      model.data.datasetFacts = { ...facts, ...next };
    },
    { immediate: true, deep: true },
  );
}

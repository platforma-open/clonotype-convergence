# Per-sample dedup for clonotype-convergence

**Ticket:** MILAB-6413
**Branch:** `MILAB-6413_convergence-per-sample-dedup` (from `MILAB-6413_single-sample-export`)
**Status:** Spike PROVEN + port in progress. DONE: spike (raw sampleId, no anon needed — verified incl. renamed-subset across projects); 3a (table/histogram pf from per-sample path, rich specs); 3b-1 (stats badge + single-sample export from per-sample path; stages 2-3 + TSV de-anon deleted). All committed, verified on remote.

REMAINING — step B (next session), each verified then commit:
1. **Per-sample logs-as-list**: capture each per-sample body's stdout, collect via processColumn keyed by sampleId, expose in model, render as a labelled list in the Logs panel. NEEDS SDK research (how processColumn collects a non-Xsv per-sample output; model resolution; UI list component). Workflow + model + UI.
2. **Skipped warning model-side**: replace the workflow skippedJson with a model-side diff (input dataset samples − convergence-output samples), labelled with real names via findLabels; carry nMin from args. Drops deanonimize-skipped + sampleLabelLookup + stage1's skippedJson use.
3. **Delete the whole-dataset path**: once logs + skipped are off it — remove the anonymize step, inputTsv (anonymized), stage1 (computeNeighboursTpl render), anonMapping; delete dead template files `apply-threshold.tpl.tengo`, `cluster-filter.tpl.tengo`, `deanonimization.tpl.tengo`, `deanonimize-skipped.tpl.tengo`; revert compute_neighbours.py neutral-counter logging (per-sample bodies have real per-sample context now). This ENDS the double-compute.
4. Re-test all modes (bulk / SC / peptide / dual-chain) + subset dedup acceptance.

Key facts to carry: per-sample fan-out = `aggregate:[clonotypeKey]` (group=sampleId); group key NOT in body identity (passKey off) → sampleId-independent dedup, NO anonymization; processColumn results need `stepCache` pinning; `xsv.exportFrame` uses pl7.app/label as TSV header (build header-stable pframes). Commits: b0e03dc (raw spike), 51989b5 (3a), 2625db5 (3b-1).
**Depends on:** the cross-project anonymization work on `MILAB-6413_single-sample-export` — this refactor *removes* it (per-sample dedup needs no anonymization; see below).

---

## Problem

Cross-project dedup (shipped on the export branch) only fires when two projects run the **exact same sample set**. A second project analysing a **subset** re-computes everything, even for shared samples. Goal: make the heavy per-sample convergence computation dedup **per sample**, so a subset project recovers each shared sample from cache.

## Why the whole-dataset pipeline can't do subsets

The per-sample math is batched into **one exec over one whole-dataset TSV** → a single cache node keyed on the whole input. `{A,B,C}` and `{B,C}` are different inputs → different CID → no hit, even for identical B/C.

## Validated approach (spike proven)

Fan out per sample via `pframes.processColumn`. Three facts, all **verified against the SDK and empirically**:

1. **`aggregate` names the *collapsed* (in-group) axis; the group identity is the complement.** (`calculateGroupAxesIndices` = all axes minus the aggregate axes, `pframes/util.lib.tengo:393` + tests.) So per-sample fan-out is `aggregate: [{ name: <clonotypeKey axis> }]` → **group = sampleId**. (`aggregate: [sampleId]` would group per *clonotype* — the opposite.)

2. **No anonymization is needed.** The runner re-keys each group's body input to the *remaining* (clonotype) axis — the **`sampleId` (group key) is stripped from the body input** (`process-pcolumn-data.tpl.tengo`). So each per-sample node's input depends only on that sample's clonotype data → its CID is identical across projects for the same sample → content-addressed recovery, with the real `sampleId` re-attached on output. The whole anonymize/de-anon apparatus from the export branch is **deleted**.

3. **`extra` is passed WHOLE to every group** (runner forwards it verbatim) — so it cannot carry per-clonotype data without breaking subset dedup. Only the single scalar primary is sliced per group.

### The load-bearing constraint (O1) — solved by packing

Each per-sample node needs `abundance + aaCDR3 + ntCDR3`, but `processColumn` slices only **one scalar primary**, and `extra` is whole. So all three fields must ride through the *sliced primary*. A PColumn is single-valued, so we **pack** them into one String value per `(sampleId, clonotypeKey)`:

- **Encode** (main body): `pt` reads the joined TSV, `concatStr([abundance, aaSeqCDR3, nSeqCDR3], {delimiter:"|"})` → a `(sampleId, clonotypeKey) → String` column, imported partitioned by sampleId.
- **processColumn** `aggregate: [{name: clonotypeAxis}]` → per-sample slice (clonotype → packed), `sampleId` stripped.
- **Per-sample body** unpacks the String (pt `extractEcmaRegex` capture groups), writes a TSV, runs `compute_neighbours --sample-column ""` (one sample, grouping disabled).

### Cache pinning is REQUIRED (the bug the spike caught)

Without pinning, the per-sample results are unreferenced after a render and dropped by reference-counting GC → re-executed every run → **no recovery** (observed empirically: identical re-run re-executed). Fix, both applied:
- `stepCache: 24 * times.hour` on the `processColumn` (pins each per-sample iteration), and
- `cacheHours(24)` on the body's `compute_neighbours` exec.
This mirrors the whole-dataset `compute-neighbours.tpl`'s `cacheHours(24)`.

### Empirical proof

Live-watch of workdirs for the per-sample decode signature (`extract_ecma_regex` in `workflow_sc.json`), since **successful workdirs are GC'd and only failed ones persist** (so counting must be live):
- Project 1 (full set, post-fix) computes + pins all samples.
- **Separate** project 2 with a subset → watcher **silent** (shared samples recovered cross-project).
- Project 2 + one brand-new sample → watcher prints **exactly that one** → confirms recovery is genuine, not a broken watcher.

### Gotchas discovered (carry into the port)

- `xsv.exportFrame` writes each column's **`pl7.app/label`** as the TSV header (not the spec `name`). Set clean labels (`clonotypeKey`, `packed`) so the pt decode references stable headers.
- Every exported column spec must carry a `pl7.app/label` annotation or `exportFrame` asserts.
- Successful workdirs GC; only failures persist → dedup verification must be a **live** watch.

## Remaining work for the full port

The spike runs only `compute_neighbours` as an isolated parallel output (`perSampleConvergencePf`). To make this the real pipeline:

- **Move stages 2-3 (apply-threshold, cluster-filter) into the per-sample body** (they're already per-sample — group by sample) so the per-sample node produces the full column set (neighbours, Nb_freq, fastStar, cluster cols).
- **Reassemble** the per-sample outputs into the block's real table/histogram pframes (keyed by the real `sampleId`).
- **Sidecars (skipped / stats) model-side:** emit per-sample flags (sampleId → skipped?/hit-count) and assemble `belowMin` / the badge in the model from the (real-sampleId-keyed) columns — cleaner than today's JSON remap, and de-anon-free.
- **Delete** the whole-dataset stages + the anonymize/de-anon templates (`anonymization`/`deanonimization`/`deanonimize-skipped`) and the spike scaffolding (the `perSampleConvergencePf` parallel output).
- **Logs** are fixed by construction (each exec is one sample, real context — the neutral-counter workaround can be reverted).
- **Single-sample export** likely simplifies (a sample's output is directly addressable per group).
- **Re-test** across bulk / single-cell / peptide / dual-chain modes.

## Out of scope

- Changing the convergence algorithm or output specs.
- The single-sample export feature itself (export branch); only its interaction with the new structure.

## Test plan

- Per-mode integration tests (bulk / SC / peptide / dual-chain).
- Acceptance: separate project with a subset of a prior project's samples → shared samples recover (live workdir watch silent); a new sample re-executes.

## Estimate

Medium — a few days. The risky mechanism is proven; remaining work is porting stages 2-3 + sidecar reassembly + mode coverage.

## Known issue — deferred (separate branch, unrelated to this work)

**Spurious "missing CDR3" input warning after a block reload/version update, which blocks re-running.**

Symptom: after rebuilding/updating the block (or, for end users, on a published version update), the Settings panel shows *"Selected input is missing required CDR3 columns — re-select an input."* even though a valid input is selected and results exist. Because the args lambda reads the same `data.mainRefFacts` snapshot (`model/src/index.ts` R5 checks), args throws → **Run is disabled** → the user cannot recompute (e.g. on a changed threshold). Re-selecting the same input clears it, but nothing tells the user that.

Root cause: `mainRefFacts` is a snapshot written into `data` by `onPickMain` (`ui/src/pages/SettingsPanel.vue`) from `factsByRef`. On reload the result pool repopulates incrementally; the required input dropdown reconciles during that window and re-fires `onPickMain`, which snapshots **partial** facts (anchor present, CDR3 sibling specs not back yet → `hasAaCDR3/hasNtCDR3 = false`). The existing `datasetOptions` gate keeps the selected option only when `getOptions(...)` returns it, but during full repopulation `getOptions` is transiently empty, so the option vanishes and the dropdown reconciles.

Fix direction (two guards): (1) in `datasetOptions`, always retain the current `data.mainRef` (synthesized from `data.mainRef` + `data.mainRefLabel`) even when the pool transiently drops it, so the dropdown never reconciles it away; (2) guard `onPickMain` from overwriting a good snapshot with not-ready facts for the same ref. Keep the snapshot pattern (args must stay `data`-only).

Scope: **unrelated to per-sample dedup** — it lives in the input-picker / facts-snapshot machinery (which already has race mitigation), so it needs its own branch, spec, and verification (reproduce after-update state; confirm no spurious alert and Run stays enabled; confirm a genuinely CDR3-less input still warns). Likely worth a shared-SDK note too, since the facts-snapshot-on-pick pattern is copied by other blocks. To be handled in a separate session.

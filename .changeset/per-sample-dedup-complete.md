---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.model': patch
'@platforma-open/milaboratories.clonotype-convergence.ui': patch
'@platforma-open/milaboratories.clonotype-convergence.software': patch
---

Make per-sample dedup the only compute path and remove the whole-dataset
pipeline (MILAB-6413).

The convergence computation now fans out per sample via `processColumn` end to
end, so a project analysing a subset of another project's samples recovers each
shared sample from cache (and a sample re-keyed under a different sampleId in
another project still recovers — the per-sample body input carries no sampleId).
The whole-dataset `compute-neighbours` path — kept only to feed logs and the
skipped-samples warning — is deleted, ending the double-compute and the
anonymize / de-anonymize apparatus it required.

- **Logs** are now per sample: each sample's compute-neighbours stdout is
  captured as saved String content, collected per sampleId, labelled with the
  real sample name in the model, and rendered as a collapsible per-sample list
  (a "Starting…" placeholder shows until each sample finishes).
- **Skipped-samples warning** is derived model-side from a per-sample status
  sidecar (`{ nUniqueNt, nMin }` per sample) instead of a workflow JSON. It now
  distinguishes samples below the nMin floor (lowering nMin helps) from samples
  with no usable CDR3 (it won't), surfacing a separate alert for each.
- `compute_neighbours.py` is simplified to single-sample operation (the
  per-sample grouping, neutral-counter logging, and skipped-list machinery were
  whole-dataset concerns) and emits the per-sample status sidecar.
- Removes the now-dead templates: `compute-neighbours`, `deanonimize-skipped`,
  `apply-threshold`, `cluster-filter`, `deanonimization`.

**Performance (large projects):**

- The packed per-sample input is imported as **Parquet**, not JSON — JSON
  storage of one stringified key + value per clonotype dominated the preamble on
  big projects (observed: a 50M-read project stuck >90 min in the import; Parquet
  cut the whole preamble to ~10 min).
- The whole-dataset join → pack → import preamble runs in a new `pack-input`
  pure template whose packed-column output is **pinned** (24h TTL). This lets a
  second block with the same settings (and project copies) recover the packed
  input instead of rebuilding it, on top of the per-sample compute recovery.

No change to the convergence algorithm, output column specs, stats badge, or
single-sample export.

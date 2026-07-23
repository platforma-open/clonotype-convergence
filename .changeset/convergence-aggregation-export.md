---
'@platforma-open/milaboratories.clonotype-convergence.software': minor
'@platforma-open/milaboratories.clonotype-convergence.workflow': minor
'@platforma-open/milaboratories.clonotype-convergence.model': minor
'@platforma-open/milaboratories.clonotype-convergence.ui': minor
'@platforma-open/milaboratories.clonotype-convergence': minor
---

Add the clonotype-only aggregated export (A-0011) — the downstream-consumable convergence signal.

A clonotype seen in several samples collapses to one value per column on the clonotype-only axis (A-0006), exported to the result pool for the in-vivo repertoire score / lead selection. Aggregation always runs within a single mode (A-0003); only `starScore` + `starHit` are exported, never the per-sample `neighbours`.

- **Software:** new `aggregate` entrypoint. Two-level shape — eligibility filter → unit assignment → within-unit collapse (max) → across-unit aggregate. `starScore` is a reproducibility-aware blend of two percentile ranks across clonotypes: `w·pct(peak) + (1−w)·pct(support)`, where `peak` is the clone's strongest per-donor convergence and `support` is its cross-donor hit count; no independence grouping → `support` undefined → `pct(peak)` alone. Private / low-support clones are downranked but never emptied. `starHit` = full-STAR: per-clonotype k-th-ordered per-unit p (k=1 ⇒ min-p × multiplicity) → Benjamini-Hochberg across clonotypes at `alpha`; fast-STAR: per-unit hit count ≥ k (k=1 ⇒ max(nbFreq) > threshold). `support` is computed internally (feeding the blend + the k-call) but is not itself exported. Unit-tested (incl. the w=1 / w=0 ranking flip).
- **Workflow:** whole-dataset Stage 4 per chain, consuming the reassembled per-sample table and emitting `starScore` / `starHit` on the clonotype-only axis as `exports.*` (same column identity as the per-sample family, A-0012, one axis less) and as a model-facing output for the block's own table. The optional sample-metadata columns (expected-sample filter, independence grouping) are resolved BY REF — the refs in args establish the samples-block dependency, like the Pgen ref.
- **Model / UI:** a "Repertoire aggregation (export)" settings section — expected-sample filter (metadata column + value multiselect) and independence grouping (metadata column); setting the grouping alone turns on cross-donor reproducibility (k=2) and the support half of `starScore` — `k` is not separately exposed. Advanced adds the single strength↔reproducibility weight `w` (default 0.5) alongside the FDR target `alpha`. A new "Aggregated (export)" page tables the clonotype-only export so the exported signal is visible in the block, not only pooled downstream.

Deferred (A-0011, future work, not blocking): mean/median within-unit collapse, the large-cohort α-trim, and multi-column/tuple independence grouping.

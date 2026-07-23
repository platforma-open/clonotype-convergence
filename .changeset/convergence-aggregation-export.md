---
'@platforma-open/milaboratories.clonotype-convergence.software': minor
'@platforma-open/milaboratories.clonotype-convergence.workflow': minor
'@platforma-open/milaboratories.clonotype-convergence.model': minor
'@platforma-open/milaboratories.clonotype-convergence.ui': minor
'@platforma-open/milaboratories.clonotype-convergence': minor
---

Add the clonotype-only aggregated export (A-0011) — the downstream-consumable convergence signal.

A clonotype seen in several samples collapses to one value per column on the clonotype-only axis (A-0006), exported to the result pool for the in-vivo repertoire score / lead selection. Aggregation always runs within a single mode (A-0003). The pool export carries the aggregated `starScore` + `starHit` (clonotype-only) plus the full per-sample `neighbours` column (both `sampleId` and clonotypeKey axes), which downstream consumes as a raw per-sample signal.

- **Software:** new `aggregate` entrypoint. Two-level shape — eligibility filter → unit assignment → within-unit collapse (max) → across-unit aggregate. `starScore` is a reproducibility-aware blend of two percentile ranks across clonotypes: `w·pct(peak) + (1−w)·pct(support)`, where `peak` is the clone's strongest per-donor convergence and `support` is its cross-donor hit count; no independence grouping → `support` undefined → `pct(peak)` alone. Private / low-support clones are downranked but never emptied. `starHit` = full-STAR: per-clonotype k-th-ordered per-unit p (k=1 ⇒ min-p × multiplicity) → Benjamini-Hochberg across clonotypes at `alpha`; fast-STAR: per-unit hit count ≥ k (k=1 ⇒ max(nbFreq) > threshold). `support` is computed internally (feeding the blend + the k-call) but is not itself exported. Unit-tested (incl. the w=1 / w=0 ranking flip).
- **Workflow:** whole-dataset Stage 4 per chain, consuming the reassembled per-sample table and emitting `starScore` / `starHit` on the clonotype-only axis as `exports.*` (same column identity as the per-sample family, A-0012, one axis less) and as a model-facing output for the block's own table. The optional sample-metadata columns (timepoint filter, biological-replicate grouping) are resolved BY REF — the refs in args establish the samples-block dependency, like the Pgen ref.
- **Model / UI:** an always-visible aggregation settings section — a timepoint filter (metadata column + value multiselect) and a biological-replicate grouping (metadata column); setting the grouping alone turns on cross-donor reproducibility (k=2) and the support half of `starScore` — `k` is not separately exposed. Advanced adds the single strength↔reproducibility weight `w` (default 0.5) alongside the FDR target `alpha`. The Main table shows the clonotype-only aggregated signal (`starScore` / `starHit`) with the same clonotype-keyed enrichment as the per-sample table — MiXCR context columns (Clone ID, genes, CDR3, abundance) are available in the column panel, hidden by default. The per-sample table lives on its own page.

**Chain-domain fix:** convergence columns now stamp the correct chain domain per mode — single-cell uses the column-domain `pl7.app/vdj/scClonotypeChain` letter (`A`/`B`), matching the SC clonotype-key convention (gen-prob's Pgen, MiXCR siblings); bulk keeps `pl7.app/vdj/chain`. Previously SC columns carried a bulk-style `pl7.app/vdj/chain`, which broke enrichment against SC siblings.

**Stats:** the hit-statistics badge now counts the aggregated, clonotype-only export — convergent clonotypes / total clonotypes — instead of summing per-sample hits (which counted a shared clonotype once per sample).

**Automatic Generation Probability detection:** Pgen availability + refs are now re-discovered from the live result pool every render (`pgenStatus` output) and mirrored into the dataset snapshot by a UI watcher, instead of being frozen at dataset-pick time. Generation Probability added, removed, or re-created (new blockId) after the pick is picked up automatically — full-STAR toggles and the ref refreshes with no re-pick. Fixes the failure where a stale/dead Pgen ref made full-STAR silently produce 0 hits.

**Benjamini-Hochberg fix (`full_star.py` + `aggregate.py`):** the crossing loop started at the second ordered p-value, so a test set where even the smallest p-value failed its own BH threshold still forced the lowest-p clonotype to `Hit`. The loop now tests from rank 1 with the correct 1-based threshold `(rank/m)·alpha`, yielding zero hits when nothing is significant. The STAR reference (M1 golden) still matches exactly.

Deferred (A-0011, future work, not blocking): mean/median within-unit collapse, the large-cohort α-trim, and multi-column/tuple independence grouping.

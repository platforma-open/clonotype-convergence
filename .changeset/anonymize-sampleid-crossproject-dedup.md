---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.software': patch
---

Anonymize the per-sample abundance before the heavy neighbour pipeline so identical datasets deduplicate across projects: Stages 1-3 (compute-neighbours, apply-threshold, cluster-filter) become content-identical regardless of project-local sample ids and recover from cache. Real sample ids are restored after the pure stages (main table + single-sample export), and the skipped-samples report is de-anonymized back to human sample labels. Stage logs reference samples by a project-neutral counter (e.g. "3/12") instead of the anonymized id, keeping logs live-streamed and dedup-safe.

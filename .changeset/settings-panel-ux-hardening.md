---
'@platforma-open/milaboratories.clonotype-convergence.model': patch
'@platforma-open/milaboratories.clonotype-convergence.ui': patch
---

Settings-panel UX hardening.

- Auto-close the Settings panel on a committed Run via a new `runArgsId` output
  (canonicalized `activeArgs`) instead of watching the `isRunning` edge. The
  `isRunning` false→true edge raced on the running-state sync and was missed for
  fast / cached recomputes (threshold or export-sample changes), so the panel
  intermittently stayed open after Run.
- Keep the already-selected input dataset in `datasetOptions` unconditionally.
  Post-run pool churn could briefly fail its CDR3-readiness gate and drop it
  from the options, making the `required` dropdown reconcile to another dataset
  — a transient input flip (e.g. IG Heavy → IG Light) with a spurious "no BCR
  chain" alert that healed when the pool settled. The gate still applies to
  datasets that aren't currently selected.

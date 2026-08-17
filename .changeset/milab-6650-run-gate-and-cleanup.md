---
"@platforma-open/milaboratories.clonotype-convergence.software": patch
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence.model": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: refuse to run on a dataset the workflow can't process, plus cleanup

The input dataset used to be validated in the dropdown: a dataset was offered
only once its aa/nt CDR3 and abundance siblings were discoverable. That gate was
removed because it hid valid datasets for as long as any other block in the
project was running — but it was also the only thing keeping an unprocessable
dataset away from the Run button, so the block would start and fail deep in the
workflow instead.

The check now lives in the args lambda, which is where Run-gating belongs:

- no aa/nt CDR3, or no abundance → Run is disabled with the reason, and the
  dropdown still lists every BCR dataset;
- no BCR chain detected → Run is disabled. Previously this filled neither chain
  slot, the workflow skipped both chain branches, and the block reported
  success with no outputs at all.

Validating here reads the pick-time snapshot rather than a live pool query, so
it can't flicker while an unrelated block runs — the failure mode that forced
the original gate out.

Other changes, no behaviour attached:

- `aggregate.py` requires `--score-column` / `--hit-column` /
  `--reproducibility-column` instead of defaulting them to retired v1 names.
  Those flags select which mode is aggregated and name the output columns, so a
  default silently aggregates the wrong mode rather than failing.
- Dead code removed: an unused `scipy.stats.chi2` import, the never-read
  `settingsOpen` / `logsOpen` block-data fields, and a workflow-side `alpha`
  fallback that duplicated the model's default.
- Duplication collapsed in the model — the two per-sample log outputs, the four
  distribution p-frame outputs, the two table column filters and the four hit
  stats resolvers now share named helpers.
- Comments corrected where they described code that no longer exists, including
  a per-sample light-chain table that was never built.

---
'@platforma-open/milaboratories.clonotype-convergence.model': patch
'@platforma-open/milaboratories.clonotype-convergence.ui': patch
---

Fix spurious "missing required CDR3 columns" warning that could disable Run after a block reload / dev-block update.

The input's CDR3/abundance facts are snapshotted into block data at pick time. While the result pool repopulates, the CDR3 sibling columns are transiently absent, so a re-pick in that window could persist a partial snapshot (`hasAaCDR3`/`hasNtCDR3` false), which the args gate and settings alert then trusted — disabling Run until the user re-picked.

- `args` and the settings alert no longer gate on the churn-prone CDR3/abundance flags. The dataset dropdown only offers CDR3-ready inputs and the workflow hard-requires those columns, so the checks were redundant false-positive sources. A genuinely unavailable input still disables Run via the ref in args (`missingReference`). This also recovers already-affected projects on reopen.
- `onPickMain` does nothing when the current dataset is re-picked (a re-emit during repopulation can no longer overwrite the good snapshot, and the light-chain pick is no longer cleared on an unchanged dataset). `factsFor` returns a copy so the persisted snapshot doesn't alias the reactive outputs object.

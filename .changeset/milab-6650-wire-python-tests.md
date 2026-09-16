---
"@platforma-open/milaboratories.clonotype-convergence.software": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: run the software package's pytest suite in CI

The 60 python tests were never executed by `turbo run test` — the software
package had no `test` script, so the suite that pins the vendored fast-STAR
implementation to the paper's published reference
(`test_get_df_equivalence.py`) and covers the aggregation statistics only ran
when someone remembered to invoke pytest by hand.

`software/scripts/run-python-tests.sh` provisions the environment itself,
because the shared Node CI sets up no interpreter and offers no hook to add
one:

  - `uv` present -> ephemeral env from `src/requirements.txt`; uv fetches its
    own Python, so the runner needs nothing else. ~12s warm.
  - `uv` absent  -> a venv under `.cache/`, reused between runs.
  - neither      -> FAILS with an explanatory message rather than skipping. A
    suite that silently skips is worse than none, because it reports green.

UNVERIFIED: whether `hz-ubuntu-dind` (the self-hosted runner this block builds
on) has `uv` or `python3`. Both paths work locally; the first CI run is the
real test. If neither is present the build fails loudly, which is the intended
failure mode — but it is a build failure, so watch the first run.

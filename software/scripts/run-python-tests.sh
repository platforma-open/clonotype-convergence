#!/usr/bin/env bash
# Run the software package's pytest suite.
#
# The suite pins the vendored fast-STAR implementation to the paper's published
# reference (test_get_df_equivalence.py) and covers the aggregation statistics,
# so it is worth running in CI — but it needs a Python environment, and the
# shared Node CI does not provision one.
#
# Two paths, preferring uv because it resolves and caches the environment in
# seconds and fetches its own interpreter, so the runner needs nothing but uv:
#
#   uv present   -> ephemeral env from src/requirements.txt, no state left behind
#   uv absent    -> a venv under .cache/, reused across runs
#
# If neither uv nor python3 exists the script FAILS rather than skipping: a
# silently-skipped test suite is worse than no suite, because it reports green.
set -euo pipefail

cd "$(dirname "$0")/.."

REQ="src/requirements.txt"
PYTEST_ARGS=("test" "-q")

if command -v uv >/dev/null 2>&1; then
  echo "[python-tests] using uv"
  exec uv run --quiet --python 3.12 \
    --with-requirements "$REQ" --with pytest \
    pytest "${PYTEST_ARGS[@]}"
fi

if command -v python3 >/dev/null 2>&1; then
  VENV=".cache/pytest-venv"
  if [ ! -x "$VENV/bin/python" ]; then
    echo "[python-tests] uv not found; creating venv at $VENV"
    python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
  else
    echo "[python-tests] uv not found; reusing venv at $VENV"
  fi
  "$VENV/bin/python" -m pip install --quiet -r "$REQ" pytest
  exec "$VENV/bin/python" -m pytest "${PYTEST_ARGS[@]}"
fi

echo "[python-tests] ERROR: neither 'uv' nor 'python3' is available." >&2
echo "[python-tests] Install uv (https://docs.astral.sh/uv/) or provide python3." >&2
exit 1

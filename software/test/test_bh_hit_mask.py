"""Unit tests for the two Benjamini-Hochberg hit-mask selections.

The block runs BH twice, with DIFFERENT rules, on purpose:

- `full_star.py` (within a sample) stops at the FIRST ordered p-value to exceed
  its BH line — verbatim from STAR's `Output_MC.BH_procedure`. Faithfulness to
  the reference is the point; M1 reproduces STAR on this path.
- `aggregate.py` (across clonotypes) uses the textbook STEP-UP rule: reject up
  to the LARGEST rank that clears its line. Nothing ties the aggregated call to
  STAR's variant, and first-crossing is severely conservative at repertoire
  scale (see the divergence test at the bottom).

Both must agree on the cases where the two rules coincide, and both must handle
ties consistently: equal p-values can never land on opposite sides of the cut.

Run:  cd software && python -m pytest test/test_bh_hit_mask.py
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

SRC = Path(__file__).parent.parent / "src"
# full_star / aggregate import sibling modules (e.g. output_MC) by bare name.
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, SRC / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.bh_hit_mask


BH_PER_SAMPLE = _load("full_star")
BH_AGGREGATED = _load("aggregate")
BH_IMPLS = [BH_PER_SAMPLE, BH_AGGREGATED]
ALPHA = 0.005


# --- cases where both rules must agree ---------------------------------------


@pytest.mark.parametrize("bh", BH_IMPLS)
def test_none_significant_selects_nothing(bh):
    # No p-value clears its BH threshold. Regression for the bug where the
    # crossing loop started at the SECOND ordered p-value and so forced
    # order[:1] to Hit — a nonsignificant clonotype called convergent.
    p = np.array([0.9, 0.5, 0.7])
    assert bh(p, ALPHA).tolist() == [False, False, False]


@pytest.mark.parametrize("bh", BH_IMPLS)
def test_smallest_p_just_below_line_is_hit(bh):
    # p_(1) = 0.001 <= (1/3)*alpha = 0.001667 → exactly one hit (the smallest).
    p = np.array([0.9, 0.001, 0.7])
    assert bh(p, ALPHA).tolist() == [False, True, False]


@pytest.mark.parametrize("bh", BH_IMPLS)
def test_all_significant_selects_all(bh):
    p = np.array([1e-6, 2e-6, 3e-6])
    assert bh(p, ALPHA).tolist() == [True, True, True]


@pytest.mark.parametrize("bh", BH_IMPLS)
def test_empty(bh):
    assert bh(np.zeros(0), ALPHA).tolist() == []


@pytest.mark.parametrize("bh", BH_IMPLS)
@pytest.mark.parametrize("p0", [1e-9, 1e-4, 0.02, 0.9])
def test_ties_are_never_split(bh, p0):
    # Identical evidence must never produce opposite verdicts: a block of equal
    # p-values is all-hit or all-miss, whichever side of the line it falls.
    verdicts = set(bh(np.full(50, p0), 0.05).tolist())
    assert len(verdicts) == 1


# --- where the two rules deliberately diverge --------------------------------


def test_aggregated_is_step_up_where_per_sample_stops_early():
    """At repertoire scale the rules part company, and the aggregated one must
    be the step-up.

    200 clonotypes at p = 5.7e-05, then background. Rank 1 must clear
    alpha/m = 7.1e-07, which it does not, so the first-crossing rule stops
    immediately and reports NOTHING. By rank 200 the line has risen to
    1.4e-04, which those p-values clear — so step-up rejects all 200.
    """
    p = np.concatenate([np.full(200, 5.684e-05), np.full(200, 6.125e-04), np.full(70000, 1.0)])
    assert BH_PER_SAMPLE(p, 0.05).sum() == 0
    assert BH_AGGREGATED(p, 0.05).sum() == 200


def test_step_up_never_rejects_fewer_than_first_crossing():
    # Step-up is a relaxation: whatever first-crossing finds, step-up finds too.
    rng = np.random.default_rng(0)
    for _ in range(20):
        p = np.sort(rng.beta(0.3, 5.0, size=500))
        assert BH_AGGREGATED(p, 0.05).sum() >= BH_PER_SAMPLE(p, 0.05).sum()

"""Unit tests for the Benjamini-Hochberg hit-mask selection.

Regression for the bug where the crossing loop started at the SECOND ordered
p-value: when even the smallest p-value failed its own BH threshold, the code
still forced order[:1] to Hit (a nonsignificant clonotype called convergent).
The same helper lives in full_star.py (within-sample) and aggregate.py (across
units); both must behave identically.

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


BH_IMPLS = [_load("full_star"), _load("aggregate")]
ALPHA = 0.005


@pytest.mark.parametrize("bh", BH_IMPLS)
def test_none_significant_selects_nothing(bh):
    # No p-value clears its BH threshold — the fix: zero hits, not order[:1].
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

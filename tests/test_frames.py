import math
from datetime import date, timedelta

from lineup_card.frames import (LEAGUE_REFERENCE, position_medians, team_shift,
                                typical_error)
from lineup_card.models import Reading

D0 = date(2026, 8, 1)


def r(aid, day, value, pos="RP", metric="rsi_mod"):
    return Reading(athlete_id=aid, name=aid, pos=pos, day=day, metric=metric, value=value)


def test_typical_error_from_consecutive_differences():
    rows = []
    for aid in ("A", "B"):
        for i in range(12):
            rows.append(r(aid, D0 + timedelta(days=i), 0.50 + (0.02 if i % 2 else 0.0)))
    te = typical_error(rows, "rsi_mod", D0 + timedelta(days=12))
    # differences alternate +0.02 / -0.02, so TE is about 0.02 / sqrt(2)
    assert math.isclose(te, 0.02 / 2 ** 0.5, rel_tol=0.1)


def test_typical_error_needs_enough_pairs():
    rows = [r("A", D0 + timedelta(days=i), 0.5) for i in range(4)]
    assert typical_error(rows, "rsi_mod", D0 + timedelta(days=5)) is None


def test_typical_error_excludes_today():
    rows = [r("A", D0 + timedelta(days=i), 0.50 + (0.02 if i % 2 else 0.0)) for i in range(12)]
    rows.append(r("A", D0 + timedelta(days=12), 0.10))
    with_today = typical_error(rows, "rsi_mod", D0 + timedelta(days=12))
    assert with_today < 0.05


def test_position_medians_with_group_size():
    z = {"A": -1.0, "B": -0.2, "C": 0.4, "D": -2.0}
    pos = {"A": "RP", "B": "RP", "C": "RP", "D": "C"}
    out = position_medians(z, pos)
    assert out["RP"] == {"median_z": -0.2, "n": 3}
    assert out["C"] == {"median_z": -2.0, "n": 1}


def test_team_shift_beyond_noise():
    changes = [-0.04, -0.035, -0.05, -0.03, -0.045]
    pct = [-8.0, -7.0, -9.5, -6.0, -8.5]
    shift = team_shift(changes, pct, te=0.02)
    assert shift == {"median_pct": -8.0, "median_raw": -0.04, "beyond_noise": True, "n": 5}


def test_team_shift_inside_noise_and_empty():
    assert team_shift([-0.005, 0.004, 0.0], [-1, 1, 0], te=0.02)["beyond_noise"] is False
    assert team_shift([], [], te=0.02) is None


def test_league_reference_is_labeled_illustrative():
    assert "illustrative" in LEAGUE_REFERENCE["rsi_mod"]["label"]


def test_team_shift_reports_median_raw():
    shift = team_shift([-0.04, -0.05, -0.03], [-8.0, -9.0, -6.0], te=0.02)
    assert shift["median_raw"] == -0.04


def test_team_shift_up_is_never_beyond_noise():
    shift = team_shift([0.04, 0.05, 0.03], [8.0, 9.0, 6.0], te=0.02)
    assert shift["median_raw"] == 0.04 and shift["beyond_noise"] is False


def test_test_sensitivity_worked_example():
    from lineup_card.frames import test_sensitivity
    # player means 0.45, 0.50, 0.55 -> grand mean 0.50, between-player SD 0.05
    out = test_sensitivity([0.45, 0.50, 0.55], te=0.03)
    assert out["grand_mean"] == 0.5 and out["between_sd"] == 0.05
    assert out["swc"] == 0.01                       # 0.2 x 0.05
    assert out["cv_pct"] == 6.0                     # 0.03 / 0.50 x 100
    assert out["swc_te"] == 0.33                    # 0.01 / 0.03
    assert out["mdc95"] == round(1.96 * 2 ** 0.5 * 0.03, 4)
    assert out["gate"] == 0.045                     # 1.5 x TE
    assert out["rating"] == "marginal" and out["n"] == 3


def test_test_sensitivity_ratings_and_gaps():
    from lineup_card.frames import test_sensitivity
    assert test_sensitivity([0.4, 0.6], te=0.01)["rating"] == "good"
    assert test_sensitivity([0.45, 0.55], te=0.02)["rating"] == "OK"     # SWC 0.0141 / TE 0.02 = 0.71
    assert test_sensitivity([0.5], te=0.03) is None
    assert test_sensitivity([0.4, 0.6], te=None) is None

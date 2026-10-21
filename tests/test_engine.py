from datetime import date, timedelta

from lineup_card.engine import (MIN_BASELINE_SESSIONS, assess_athlete, assess_domain,
                                compute_baseline, count_consecutive_declines,
                                load_context, z_score)
from lineup_card.models import METRICS, Domain, Reading, Status

RSI = METRICS[Domain.NEUROMUSCULAR]
D0 = date(2026, 9, 1)


def series(values, start=D0):
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


def test_helpers_still_work():
    assert compute_baseline([1.0] * (MIN_BASELINE_SESSIONS - 1)) is None
    base = compute_baseline([1.0 + (0.1 if i % 2 else -0.1) for i in range(12)])
    assert round(z_score(0.8, base), 2) == round((0.8 - base.mean) / base.sd, 2)
    assert count_consecutive_declines([5, 4, 3, 2]) == 3


def test_large_drop_beyond_noise_is_review():
    pts = series([0.55, 0.57] * 10 + [0.45])
    d = assess_domain(RSI, pts, pts[-1][0], te=0.02)
    assert d.status is Status.REVIEW and d.beyond_noise is True and d.te == 0.02


def test_large_z_inside_noise_is_cleared():
    # very steady athlete: tiny SD, so a small drop has a big z
    pts = series([0.550, 0.552] * 10 + [0.540])
    d = assess_domain(RSI, pts, pts[-1][0], te=0.03)
    assert d.decline_z <= -2.0
    assert d.status is Status.CLEARED and d.beyond_noise is False
    assert any("inside test noise" in r for r in d.reasons)


def test_unknown_te_does_not_block_flag():
    pts = series([0.55, 0.57] * 10 + [0.45])
    d = assess_domain(RSI, pts, pts[-1][0], te=None)
    assert d.status is Status.REVIEW and d.beyond_noise is None
    assert any("noise not yet estimated" in r for r in d.reasons)


def _readings(rsi, well, start=D0):
    out = []
    for i, (r, w) in enumerate(zip(rsi, well)):
        day = start + timedelta(days=i)
        out.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                           metric="rsi_mod", value=r))
        out.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                           metric="wellness_score", value=w))
    return out


def test_convergence_ignores_domain_inside_noise():
    rsi = [0.550, 0.552] * 10 + [0.541]       # z very low but inside TE
    well = [20, 22] * 10 + [19]               # z about -1.9, beyond TE 0.5
    a = assess_athlete(_readings(rsi, well), D0 + timedelta(days=20),
                       te={"rsi_mod": 0.03, "wellness_score": 0.5})
    assert a.status is Status.MONITOR


def test_convergence_counts_both_when_beyond_noise():
    # each domain alone is only Watch (z about -1.4 and -1.9); together they converge
    rsi = [0.55, 0.57] * 10 + [0.546]
    well = [20, 22] * 10 + [19]
    a = assess_athlete(_readings(rsi, well), D0 + timedelta(days=20),
                       te={"rsi_mod": 0.005, "wellness_score": 0.5})
    assert a.status is Status.REVIEW


def test_load_context_sums_last_seven_days():
    rows = []
    for i in range(10):
        day = D0 + timedelta(days=i)
        rows.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                            metric="throw_count", value=10))
    rows.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=D0 + timedelta(days=9),
                        metric="pitch_count", value=25))
    lc = load_context(rows, D0 + timedelta(days=9))
    assert lc.throws_today == 10 and lc.pitches_today == 25
    assert lc.throws_7d == 7 * 10 + 25


def test_load_context_missing_is_none_not_zero():
    lc = load_context([], D0)
    assert lc.throws_7d is None and lc.player_load_today is None


def test_noise_gate_is_one_and_a_half_typical_errors():
    from lineup_card.engine import noise_threshold
    assert noise_threshold(0.02) == 0.03
    # a drop of 1.2 x TE now stays inside the noise
    pts = series([0.550, 0.552] * 10 + [0.527])      # drop 0.024, TE 0.02
    d = assess_domain(RSI, pts, pts[-1][0], te=0.02)
    assert d.beyond_noise is False and d.status is Status.CLEARED

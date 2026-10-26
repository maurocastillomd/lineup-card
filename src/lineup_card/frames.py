"""Context frames. None of these ever set a status.

  Typical error  Pooled across the squad from each player's consecutive
                 readings in the 28 days before today:
                 TE = SD(differences) / sqrt(2)  (Hopkins 2000).
  Position       Median of today's z by role, with n. Groups are small at
                 Triple-A, so a median, and n is always shown.
  Team           Median of today's raw change vs each player's normal.
                 Beyond noise only when the median is a DROP (below zero)
                 and its size exceeds 1.5 x TE. A team-wide rise is not a
                 team-shift day.
  League         One illustrative value per metric. No public MiLB VALD
                 norm exists; the label says so.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, timedelta

from .engine import noise_threshold
from .models import Reading

BASELINE_DAYS = 28
MIN_PAIRS = 10

LEAGUE_REFERENCE = {
    "rsi_mod": {"value": 0.52, "unit": "m/s",
                "label": "illustrative, not a published MLB or MiLB norm"},
    "jump_height_cm": {"value": 42.0, "unit": "cm",
                       "label": "illustrative, not a published MLB or MiLB norm"},
}


def typical_error(readings: list[Reading], metric: str, today: date) -> float | None:
    start = today - timedelta(days=BASELINE_DAYS)
    by_athlete: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for r in readings:
        if r.metric == metric and start <= r.day < today:
            by_athlete[r.athlete_id].append((r.day, r.value))
    diffs = []
    for points in by_athlete.values():
        values = [v for _, v in sorted(points)]
        diffs += [b - a for a, b in zip(values, values[1:])]
    if len(diffs) < MIN_PAIRS:
        return None
    return round(statistics.stdev(diffs) / 2 ** 0.5, 4)


def position_medians(z_by_id: dict[str, float], pos_by_id: dict[str, str]) -> dict[str, dict]:
    groups: dict[str, list[float]] = defaultdict(list)
    for lc_id, z in z_by_id.items():
        groups[pos_by_id[lc_id]].append(z)
    return {pos: {"median_z": round(statistics.median(zs), 2), "n": len(zs)}
            for pos, zs in groups.items()}


def team_shift(raw_changes: list[float], pct_changes: list[float], te: float | None) -> dict | None:
    if not raw_changes:
        return None
    median_raw = statistics.median(raw_changes)
    return {"median_pct": round(statistics.median(pct_changes), 1),
            "median_raw": round(median_raw, 4),
            "beyond_noise": te is not None and median_raw < 0 and abs(median_raw) > noise_threshold(te),
            "n": len(raw_changes)}


MDC95_FACTOR = 1.96 * 2 ** 0.5   # 95% minimal detectable change = 1.96 x sqrt(2) x TE


def test_sensitivity(player_means: list[float], te: float | None) -> dict | None:
    """How sensitive is this test for this squad? (Hopkins 2000)

    SWC is 0.2 x the between-player SD of each player's normal. When TE is
    bigger than SWC, one reading cannot settle a change that small. Rating
    bands (a convention): SWC/TE >= 1 good, >= 0.5 OK, below 0.5 marginal.
    """
    if te is None or len(player_means) < 2:
        return None
    grand_mean = statistics.fmean(player_means)
    between_sd = statistics.stdev(player_means)
    swc = 0.2 * between_sd
    ratio = swc / te
    return {
        "n": len(player_means),
        "grand_mean": round(grand_mean, 4),
        "between_sd": round(between_sd, 4),
        "te": te,
        "cv_pct": round(te / grand_mean * 100, 1),
        "swc": round(swc, 4),
        "swc_te": round(ratio, 2),
        "mdc95": round(MDC95_FACTOR * te, 4),
        "gate": round(noise_threshold(te), 4),
        "rating": "good" if ratio >= 1 else "OK" if ratio >= 0.5 else "marginal",
    }

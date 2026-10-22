"""Context frames. None of these ever set a status.

  Typical error  Pooled across the squad from each player's consecutive
                 readings in the 28 days before today:
                 TE = SD(differences) / sqrt(2)  (Hopkins 2000).
  Position       Median of today's z by role, with n. Groups are small at
                 Triple-A, so a median, and n is always shown.
  Team           Median of today's raw change vs each player's normal.
                 Beyond noise when its size exceeds 1.5 x TE.
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
            "beyond_noise": te is not None and abs(median_raw) > noise_threshold(te),
            "n": len(raw_changes)}

"""Cleaning rules. Every decision is written to the CleanLog so the coach
can see it in the review step.

  Trials    Drop a CMJ trial more than 10% from the median of that day's
            trials (practitioner convention). Use the mean of the rest
            (Claudino et al. 2017). Fewer than 2 valid trials: no value.
  Sessions  Sum Catapult periods per player per day. Ignore any period
            named like a session total so nothing counts twice.
  Duplicates  Two Catapult rows for one player, day and period number count
            once (first kept). Two wellness forms for one player and day:
            the last one in file order is kept. Both are logged.
  Identity  Unmatched names or IDs are held out, never guessed.
  Missing   Missing stays missing. Nothing becomes zero.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from pydantic import BaseModel, Field

from .adapters.catapult import CatapultPeriod
from .adapters.vald import CmjTrial
from .adapters.wellness import WellnessRow
from .crosswalk import Crosswalk
from .models import JUMP_HEIGHT, PITCHES, PLAYER_LOAD, THROWS, Reading

OUTLIER_FRACTION = 0.10
MIN_TRIALS = 2


class LogEntry(BaseModel):
    lc_id: str
    day: date
    source: str
    rule: str
    detail: str


class CleanLog(BaseModel):
    entries: list[LogEntry] = Field(default_factory=list)
    held_out: list[dict] = Field(default_factory=list)

    def add(self, lc_id: str, day: date, source: str, rule: str, detail: str) -> None:
        self.entries.append(LogEntry(lc_id=lc_id, day=day, source=source, rule=rule, detail=detail))

    def hold(self, source: str, raw: str) -> None:
        item = {"source": source, "raw": raw, "reason": "not in crosswalk"}
        if item not in self.held_out:
            self.held_out.append(item)


def _reading(cw: Crosswalk, lc_id: str, day: date, metric: str, value: float, source: str) -> Reading:
    p = cw.player(lc_id)
    return Reading(athlete_id=lc_id, name=p.name, pos=p.pos, day=day,
                   metric=metric, value=value, source=source)


def _clean_trials(values: list[float]) -> tuple[list[float], list[float]]:
    median = statistics.median(values)
    keep = [v for v in values if abs(v - median) <= OUTLIER_FRACTION * median]
    drop = [v for v in values if v not in keep]
    return keep, drop


def clean_cmj(trials: list[CmjTrial], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    groups: dict[tuple[str, date], list[CmjTrial]] = defaultdict(list)
    for t in trials:
        lc_id = cw.from_vald(t.external_id)
        if lc_id is None:
            log.hold("vald", t.external_id)
            continue
        groups[(lc_id, t.day)].append(t)

    out: list[Reading] = []
    for (lc_id, day), group in sorted(groups.items()):
        rsi = [t.rsi_mod for t in group if t.rsi_mod is not None]
        if not rsi:
            continue
        keep, drop = _clean_trials(rsi)
        for value in drop:
            log.add(lc_id, day, "vald", "trial_outlier",
                    f"RSI-mod trial {value:.3f} more than 10% from the set median; dropped")
        if len(keep) < MIN_TRIALS:
            log.add(lc_id, day, "vald", "too_few_trials",
                    f"{len(keep)} valid CMJ trial(s); no value recorded today")
            continue
        out.append(_reading(cw, lc_id, day, "rsi_mod", statistics.fmean(keep), "vald"))
        kept_jumps = [t.jump_height_cm for t in group
                      if t.rsi_mod in keep and t.jump_height_cm is not None]
        if kept_jumps:
            out.append(_reading(cw, lc_id, day, JUMP_HEIGHT, statistics.fmean(kept_jumps), "vald"))
    return out


def clean_catapult(periods: list[CatapultPeriod], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    sums: dict[tuple[str, date, str], float] = defaultdict(float)
    seen: set[tuple[str, date, int]] = set()
    for p in periods:
        if "total" in p.period_name.lower():
            continue
        lc_id = cw.from_catapult(p.player_name)
        if lc_id is None:
            log.hold("catapult", p.player_name)
            continue
        period_key = (lc_id, p.day, p.period_number)
        if period_key in seen:
            log.add(lc_id, p.day, "catapult", "duplicate_period",
                    f"duplicate Catapult period {p.period_number}; counted once")
            continue
        seen.add(period_key)
        for metric, value in ((PLAYER_LOAD, p.player_load), (THROWS, p.throw_count),
                              (PITCHES, p.pitch_count)):
            if value is not None:
                sums[(lc_id, p.day, metric)] += value
    return [_reading(cw, lc_id, day, metric, value, "catapult")
            for (lc_id, day, metric), value in sorted(sums.items())]


def clean_wellness(rows: list[WellnessRow], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    last: dict[tuple[str, date], WellnessRow] = {}
    for r in rows:
        if (r.athlete_id, r.day) in last and r.athlete_id in cw.players:
            log.add(r.athlete_id, r.day, "wellness", "duplicate_form",
                    "duplicate wellness form; kept the last one")
        last[(r.athlete_id, r.day)] = r      # file order: the last row wins
    out = []
    for r in last.values():
        if r.athlete_id not in cw.players:
            log.hold("wellness", r.athlete_id)
            continue
        if r.score is None:
            log.add(r.athlete_id, r.day, "wellness", "incomplete_form",
                    "wellness form incomplete; no score today")
            continue
        out.append(_reading(cw, r.athlete_id, r.day, "wellness_score", r.score, "wellness"))
    return out

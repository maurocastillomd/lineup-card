"""The deterministic core. All math lives here. No AI anywhere in this file.

Rules (plain English, because a coach has to trust them):

  Baseline     Each response metric is measured against the athlete's OWN
               28-day rolling baseline (min 10 readings). Direction is
               sign-normalized to a "goodness" scale so a decline is always
               a negative z and one threshold set serves every domain.

  Per domain   REVIEW z <= -2.0; MONITOR z <= -1.2 or 3+ consecutive
               declines past the smallest worthwhile change (0.2 x SD);
               else within range when assessable; missing data stays explicit.

  Convergence  Athlete status escalates on agreement: REVIEW if any domain
               is REVIEW, or if >= 2 assessable domains sit at/under -1.2.
               Else MONITOR if any domain is MONITOR. Else within range only
               when all response domains are assessable; otherwise insufficient.

  Context      Jump height, PlayerLoad, throws and pitches come along as
               CONTEXT. They never set a status.

  Noise gate   A flag also needs the drop from baseline to exceed 1.5 x
               the metric's typical error (TE, Hopkins 2000), estimated
               from the squad's own repeat readings. A big z inside that
               band is "No change". Unknown TE never blocks a flag; the reason
               says the noise is not yet estimated.

  Freshness    Streams arrive on different clocks. A domain is assessed
               from its most recent reading within FRESHNESS_DAYS; with no
               fresh reading it is "insufficient data" and never flags.

Nothing here predicts injury. It surfaces individual change in readiness.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, timedelta

from .models import (METRICS, PITCHES, PLAYER_LOAD, THROWS, AthleteAssessment,
                     Baseline, Domain, DomainAssessment, LoadContext, MetricSpec,
                     ReadinessDriver, Reading, Status)

BASELINE_DAYS = 28
MIN_BASELINE_SESSIONS = 10
FRESHNESS_DAYS = 4
LOAD_DAYS = 7
NOISE_GATE_MULTIPLIER = 1.5
REVIEW_Z = -2.0
MONITOR_Z = -1.2
CONVERGENCE_Z = -1.2
MONITOR_DECLINE_SESSIONS = 3
TREND_SESSIONS = 14
SWC_FACTOR = 0.2

SEVERITY = {Status.REVIEW: 0, Status.MONITOR: 1, Status.INSUFFICIENT: 2,
            Status.CLEARED: 3}


def goodness(value: float, higher_is_worse: bool) -> float:
    return -value if higher_is_worse else value


def compute_baseline(values: list[float]) -> Baseline | None:
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Baseline values must be finite")
    if len(values) < MIN_BASELINE_SESSIONS:
        return None
    mean = statistics.fmean(values)
    sd = statistics.stdev(values)
    if sd == 0 or not math.isfinite(sd) or not math.isfinite(mean):
        return None
    return Baseline(mean=mean, sd=sd, n=len(values), swc=SWC_FACTOR * sd)


def z_score(today: float, base: Baseline) -> float:
    return (today - base.mean) / base.sd


def rolling(points: list[tuple[date, float]], days: int) -> list[tuple[date, float]]:
    """Trailing calendar mean, emitted only for complete daily windows."""
    if days <= 1:
        return list(points)
    out: list[tuple[date, float]] = []
    for i, (d, _) in enumerate(points):
        window = [v for (dd, v) in points[: i + 1] if d - timedelta(days=days - 1) <= dd <= d]
        if len(window) == days:
            out.append((d, statistics.fmean(window)))
    return out


def count_consecutive_declines(values: list[float]) -> int:
    run = 0
    for prev, cur in zip(reversed(values[:-1]), reversed(values[1:])):
        if cur < prev:
            run += 1
        else:
            break
    return run


def noise_threshold(te: float) -> float:
    """The smallest drop (raw units) that counts as more than test noise.

    te is the typical error: SD of day-to-day differences / sqrt(2).
    For reference: 1 x TE is the loosest common rule; MDC95 is
    1.96 x sqrt(2) x TE, about 2.77 x TE, the strictest.
    """
    # Rule chosen by Mauro Castillo, 2026-10-21: 1.5 x TE. A middle ground for a
    # daily report: fewer false alarms than 1 x TE, far fewer missed declines
    # than MDC95. No validated cutoff exists for pro baseball CMJ.
    return NOISE_GATE_MULTIPLIER * te


def assess_domain(spec: MetricSpec, points: list[tuple[date, float]],
                  today: date, te: float | None = None) -> DomainAssessment:
    """Assess one response domain from its raw (day, value) series."""
    pts = sorted((d, v) for d, v in points if d <= today)
    if len({d for d, _ in pts}) != len(pts):
        raise ValueError("Multiple values for one metric-day need explicit aggregation")
    if not all(math.isfinite(v) for _, v in pts):
        raise ValueError("Response values must be finite")
    rolled = rolling(pts, spec.rolling_days)
    fresh_pts = [p for p in rolled
                 if today - timedelta(days=FRESHNESS_DAYS) <= p[0] <= today]
    if not fresh_pts:
        latest = pts[-1][0] if pts else None
        return DomainAssessment(domain=spec.domain, status=Status.INSUFFICIENT,
                                fresh=False, today=None, base=None, pct=None,
                                decline_z=None, observed_on=latest,
                                reasons=["no current complete measurement"])
    today_day, today_val = fresh_pts[-1]
    window_start = today_day - timedelta(days=BASELINE_DAYS)
    prior = [v for (d, v) in rolled if window_start <= d < today_day]
    g_prior = [goodness(v, spec.higher_is_worse) for v in prior]
    base = compute_baseline(g_prior)
    if base is None:
        return DomainAssessment(domain=spec.domain, status=Status.INSUFFICIENT,
                                fresh=True, today=round(today_val, 2), base=None,
                                pct=None, decline_z=None,
                                observed_on=today_day,
                                reasons=["baseline-building" if len(prior) < MIN_BASELINE_SESSIONS
                                         else "baseline has no usable variation"])
    g_today = goodness(today_val, spec.higher_is_worse)
    decline_z = z_score(g_today, base)
    recent = (g_prior + [g_today])[-TREND_SESSIONS:]
    declines = count_consecutive_declines(recent)
    cumulative_drop = (recent[-1 - declines] - recent[-1]) if declines else 0.0

    drop = base.mean - g_today          # goodness units; positive means worse
    beyond_noise = None if te is None else drop > noise_threshold(te)

    reasons: list[str] = []
    if decline_z <= REVIEW_Z:
        status = Status.REVIEW
        reasons.append(f"{spec.label} {abs(decline_z):.1f} SD below his 28-day normal")
    elif decline_z <= MONITOR_Z:
        status = Status.MONITOR
        reasons.append(f"{spec.label} {abs(decline_z):.1f} SD below his 28-day normal")
    elif declines >= MONITOR_DECLINE_SESSIONS and cumulative_drop > base.swc:
        status = Status.MONITOR
        reasons.append(f"{spec.label}: {declines} declining readings in a row")
    else:
        status = Status.CLEARED

    if status in (Status.REVIEW, Status.MONITOR):
        if beyond_noise is False:
            status = Status.CLEARED
            reasons = [f"{spec.label} drop inside test noise (TE {te:g} {spec.unit})"]
        elif beyond_noise is True:
            reasons[-1] += " and beyond test noise"
        else:
            reasons[-1] += "; test noise not yet estimated"

    raw_mean = -base.mean if spec.higher_is_worse else base.mean
    pct = (None if raw_mean == 0
           else round((today_val - raw_mean) / raw_mean * 100.0, 1))
    return DomainAssessment(domain=spec.domain, status=status, fresh=True,
                            today=round(today_val, 3), base=base,
                            pct=pct, decline_z=decline_z, observed_on=today_day,
                            consecutive_declines=declines, reasons=reasons,
                            te=te, beyond_noise=beyond_noise)


def _metric_series(readings: list[Reading], metric: str,
                   today: date) -> list[tuple[date, float]]:
    by_day: dict[date, float] = {}
    for r in readings:
        if r.metric == metric and r.day <= today:
            if r.day in by_day and by_day[r.day] != r.value:
                raise ValueError("Conflicting values for one athlete, metric and day; "
                                 "resolve source priority or aggregate before assessment")
            by_day[r.day] = r.value
    return sorted(by_day.items())


def _int_or_none(value: float | None) -> int | None:
    return None if value is None else int(round(value))


def load_context(readings: list[Reading], today: date) -> LoadContext:
    """Catapult workload. CONTEXT only; never sets a status."""
    def on(metric: str, day: date) -> float | None:
        vals = [r.value for r in readings if r.metric == metric and r.day == day]
        return sum(vals) if vals else None

    window = [r for r in readings if r.metric in (THROWS, PITCHES)
              and today - timedelta(days=LOAD_DAYS - 1) <= r.day <= today]
    return LoadContext(
        player_load_today=on(PLAYER_LOAD, today),
        throws_today=_int_or_none(on(THROWS, today)),
        pitches_today=_int_or_none(on(PITCHES, today)),
        throws_7d=_int_or_none(sum(r.value for r in window)) if window else None)


def assess_athlete(readings: list[Reading], today: date,
                   te: dict[str, float | None] | None = None) -> AthleteAssessment | None:
    """Assess one athlete across response domains; status by convergence.
    Retain known athletes with insufficient data; None for no as-of identity."""
    readings = [r for r in readings if r.day <= today]
    identities = {(r.athlete_id, r.name) for r in readings}
    if len(identities) > 1:
        raise ValueError("Conflicting athlete identities; resolve the roster before assessment")
    ident: tuple[str, str, str] | None = None
    for r in sorted(readings, key=lambda r: r.day, reverse=True):
        if r.day <= today:
            ident = (r.athlete_id, r.name, r.pos)
            break
    if ident is None:
        return None

    te = te or {}
    domains: list[DomainAssessment] = []
    for spec in METRICS.values():
        series = _metric_series(readings, spec.column, today)
        domains.append(assess_domain(spec, series, today, te.get(spec.column)))

    assessable = [d for d in domains if d.assessable]
    any_review = any(d.status is Status.REVIEW for d in domains)
    converging = [d for d in assessable
                  if d.decline_z <= CONVERGENCE_Z and d.beyond_noise is not False]
    if any_review or len(converging) >= 2:
        status = Status.REVIEW
    elif any(d.status is Status.MONITOR for d in domains):
        status = Status.MONITOR
    elif len(assessable) == len(METRICS):
        status = Status.CLEARED
    else:
        status = Status.INSUFFICIENT

    flagged = sorted((d for d in domains if d.status in (Status.REVIEW, Status.MONITOR)),
                     key=lambda d: (SEVERITY[d.status], d.decline_z))
    drivers = [ReadinessDriver(d.domain.value) for d in flagged]
    reasons = [r for d in flagged for r in d.reasons]
    if len(converging) >= 2:
        reasons.insert(0, f"{len(converging)} response domains at or below z "
                       f"{CONVERGENCE_Z:.1f}; convergence review rule")
    if len(assessable) < len(METRICS):
        reasons.append("Incomplete response-domain coverage; check missing or stale data")

    load = load_context(readings, today)

    aid, name, pos = ident
    return AthleteAssessment(athlete_id=aid, name=name, pos=pos, status=status,
                             domains=domains, drivers=drivers, load=load,
                             reasons=reasons)


def _worst_z(a: AthleteAssessment) -> float:
    zs = [d.decline_z for d in a.domains if d.decline_z is not None]
    return min(zs) if zs else 0.0


def assess_squad(readings: list[Reading], today: date,
                 te: dict[str, float | None] | None = None) -> list[AthleteAssessment]:
    """Assess every athlete with data. Sorted worst-first."""
    by_athlete: dict[str, list[Reading]] = defaultdict(list)
    for r in readings:
        by_athlete[r.athlete_id].append(r)
    out = [a for group in by_athlete.values()
           if (a := assess_athlete(group, today, te)) is not None]
    return sorted(out, key=lambda a: (SEVERITY[a.status], _worst_z(a)))

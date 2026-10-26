"""Build one day's JSON for the web app. Every number the card shows is
computed here; the browser only displays it."""

from __future__ import annotations

from datetime import date, timedelta

from .clean import CleanLog
from .crosswalk import Crosswalk
from .engine import (MONITOR_Z, assess_squad, compute_baseline, goodness, load_context,
                     noise_threshold, z_score)
from .frames import LEAGUE_REFERENCE, MDC95_FACTOR, test_sensitivity, position_medians, team_shift, typical_error
from .models import JUMP_HEIGHT, METRICS, AthleteAssessment, Domain, DomainAssessment, Reading, Status

CLUB = "Fictional Triple-A Club"
TREND_DAYS = 14
STATUS_WORDS = {
    Status.REVIEW: ("check_in", "Check in"),
    Status.MONITOR: ("watch", "Watch"),
    Status.CLEARED: ("no_change", "No change"),
    Status.INSUFFICIENT: ("not_enough_data", "Not enough data"),
}


def magnitude(z: float | None) -> str:
    if z is None:
        return ""
    if z <= -2.0:
        return "▼ large"
    if z <= -1.2:
        return "▼ moderate"
    return "– within noise"


DOMAIN_NAMES = {Domain.NEUROMUSCULAR: "jump", Domain.PERCEPTUAL: "wellness"}


def driver_magnitude(domains: list[DomainAssessment]) -> str:
    """Size of the change that set the status, named when it is not the jump."""
    flagged = [d for d in domains if d.status in (Status.REVIEW, Status.MONITOR)]
    if not flagged:
        return "" if all(d.decline_z is None for d in domains) else "– within noise"
    worst = min(flagged, key=lambda d: d.decline_z)
    # A Watch from 3 declines in a row can sit above the -1.2 z line; do not call it "within noise".
    size = "▼ steady decline" if worst.decline_z > MONITOR_Z else magnitude(worst.decline_z)
    return size if worst.domain is Domain.NEUROMUSCULAR else f"{size} ({DOMAIN_NAMES[worst.domain]})"


def _domain_json(d: DomainAssessment, today: date, te: float | None) -> dict:
    """observed_on / days_old say which day the reading is from, so a jump a few
    days old is never shown as today's. Both null when there is no reading."""
    when = {"observed_on": None if d.observed_on is None else d.observed_on.isoformat(),
            "days_old": None if d.observed_on is None else (today - d.observed_on).days}
    if d.base is None:
        return {"today": d.today, "mean": None, "sd": None, "z": None, "pct": None,
                "beyond_noise": None, **when}
    change = round(d.today - d.base.mean, 4)        # both domains: higher is better
    return {"today": d.today, "mean": round(d.base.mean, 3), "sd": round(d.base.sd, 3),
            "z": round(d.decline_z, 2), "pct": d.pct, "beyond_noise": d.beyond_noise,
            "change": change,
            "change_te": None if not te else round(change / te, 1),
            "beyond_mdc": None if not te else change < -round(MDC95_FACTOR * te, 4),
            "swc_personal": round(d.base.swc, 4),     # 0.2 x HIS SD (trend rule), not Hopkins' SWC
            **when}


def _trend(readings: list[Reading], lc_id: str, today: date) -> list[dict]:
    """Daily RSI-mod z vs the baseline that applied on each day."""
    spec = METRICS[Domain.NEUROMUSCULAR]
    series = sorted((r.day, r.value) for r in readings
                    if r.athlete_id == lc_id and r.metric == spec.column)
    out = []
    for offset in range(TREND_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        value = next((v for d, v in series if d == day), None)
        prior = [v for d, v in series if day - timedelta(days=28) <= d < day]
        base = compute_baseline([goodness(v, spec.higher_is_worse) for v in prior])
        z = None if value is None or base is None else round(z_score(value, base), 2)
        out.append({"date": day.isoformat(), "z": z})
    return out


def _latest(readings: list[Reading], lc_id: str, metric: str, today: date) -> float | None:
    vals = [r.value for r in readings if r.athlete_id == lc_id and r.metric == metric and r.day == today]
    return round(vals[0], 1) if vals else None


def _beyond_team(d: DomainAssessment, shift: dict | None, te: float | None,
                 today: date) -> bool | None:
    """On a team-shift day: did he drop more than the team, by more than noise?
    Context only. None when there is no team shift or no reading today."""
    if not shift or not shift["beyond_noise"] or te is None:
        return None
    if d.base is None or d.observed_on != today:
        return None
    if d.decline_z is None or d.decline_z > MONITOR_Z:
        return None          # his jump is not down: the team line does not explain his flag
    return (d.today - d.base.mean) - shift["median_raw"] < -noise_threshold(te)


def build_day(readings: list[Reading], today: date, cw: Crosswalk, log: CleanLog,
              schedule: dict) -> dict:
    te = {spec.column: typical_error(readings, spec.column, today) for spec in METRICS.values()}
    assessed: list[AthleteAssessment] = assess_squad(readings, today, te)

    rsi_by_id = {a.athlete_id: next(d for d in a.domains if d.domain is Domain.NEUROMUSCULAR)
                 for a in assessed}
    z_by_id = {k: d.decline_z for k, d in rsi_by_id.items() if d.decline_z is not None}
    medians = position_medians(z_by_id, {a.athlete_id: a.pos for a in assessed})
    tested = [d for d in rsi_by_id.values() if d.base is not None and d.observed_on == today]
    shift = team_shift([d.today - d.base.mean for d in tested],
                       [d.pct for d in tested if d.pct is not None], te["rsi_mod"])

    players = []
    for a in assessed:
        status, word = STATUS_WORDS[a.status]
        rsi = rsi_by_id[a.athlete_id]
        well = next(d for d in a.domains if d.domain is Domain.PERCEPTUAL)
        group = medians.get(a.pos, {"median_z": None, "n": 0})
        players.append({
            "id": a.athlete_id, "name": a.name, "pos": a.pos,
            "status": status, "word": word, "magnitude": driver_magnitude(a.domains),
            "reasons": a.reasons or [r for d in a.domains for r in d.reasons],
            "rsi": _domain_json(rsi, today, te["rsi_mod"]),
            "wellness": _domain_json(well, today, te["wellness_score"]),
            "jump_height_cm": _latest(readings, a.athlete_id, JUMP_HEIGHT, today),
            "position_median_z": group["median_z"], "position_n": group["n"],
            # Morning card: load runs through yesterday so tonight's game is not counted.
            "load": load_context([r for r in readings if r.athlete_id == a.athlete_id],
                                 today - timedelta(days=1)).model_dump(),
            "beyond_team": _beyond_team(rsi, shift, te["rsi_mod"], today),
            "trend": _trend(readings, a.athlete_id, today),
        })

    return {
        "date": today.isoformat(), "synthetic": True, "club": CLUB, "schedule": schedule,
        "te": te,
        "noise_gate": {k: None if v is None else round(noise_threshold(v), 4) for k, v in te.items()},
        "signal": {spec.column: test_sensitivity(
            [d.base.mean for a in assessed for d in a.domains
             if d.domain is spec.domain and d.base is not None], te[spec.column])
            for spec in METRICS.values()},
        "team_shift": shift, "league_reference": LEAGUE_REFERENCE,
        "players": players,
        "held_out": log.held_out,
        "cleaning_log": [e.model_dump(mode="json") for e in log.entries if e.day == today],
    }

"""Read every inbox folder up to a date, clean, flag and build that day.

Baselines need history, so a run for one date reads all earlier inboxes.
"""

from __future__ import annotations

import csv
import json
from datetime import date
from pathlib import Path

from .adapters.catapult import read_catapult
from .adapters.vald import read_vald
from .adapters.wellness import read_wellness
from .clean import CleanLog, clean_catapult, clean_cmj, clean_wellness
from .crosswalk import Crosswalk
from .day import CLUB, build_day

CLUB_FILE = "club.json"
STATUS_FILE = "_status.json"
STATUS_KEYS = ("vald", "catapult", "pulled_at")


def _schedule(data: Path, today: date) -> dict:
    if not (data / "schedule.csv").exists():      # optional for live data
        return {"opponent": "", "home_away": "", "note": ""}
    with (data / "schedule.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            if row["date"] == today.isoformat():
                return {"opponent": row["opponent"], "home_away": row["home_away"], "note": row["note"]}
    return {"opponent": "", "home_away": "", "note": ""}


def _club(data: Path) -> dict:
    """data/<dir>/club.json: {"name": str, "synthetic": bool}. Optional; without it the
    day is labelled as the fictional demo club, so real data must add one."""
    path = data / CLUB_FILE
    if not path.exists():
        return {"name": CLUB, "synthetic": True}
    try:
        club = json.loads(path.read_text())
    except ValueError:
        club = None
    if (not isinstance(club, dict) or not isinstance(club.get("name"), str)
            or not club["name"].strip() or not isinstance(club.get("synthetic"), bool)):
        raise ValueError(f"{path} must look like {{\"name\": \"Club name\", \"synthetic\": false}}")
    return {"name": club["name"].strip(), "synthetic": club["synthetic"]}


def _sources(folder: Path) -> dict | None:
    """inbox/<date>/_status.json written by scripts/pull.py: ok or failed per source."""
    path = folder / STATUS_FILE
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text())
    except ValueError:
        return None
    if not isinstance(raw, dict):
        return None
    return {k: raw[k] for k in STATUS_KEYS if isinstance(raw.get(k), str)}


def run_day(data: Path, today: date) -> dict:
    if not (data / "inbox" / today.isoformat()).is_dir():
        raise FileNotFoundError(f"No inbox for {today.isoformat()} (off day or not delivered)")
    cw = Crosswalk.load(data / "crosswalk.csv")
    log = CleanLog()
    readings = []
    for folder in sorted((data / "inbox").iterdir()):
        if not folder.is_dir() or folder.name > today.isoformat():
            continue
        is_today = folder.name == today.isoformat()
        day_log = log if is_today else CleanLog()
        for name, read, clean in (("vald_forcedecks_cmj.csv", read_vald, clean_cmj),
                                  ("catapult_openfield.csv", read_catapult, clean_catapult),
                                  ("wellness.csv", read_wellness, clean_wellness)):
            path = folder / name
            if path.exists():
                readings += clean(read(path), cw, day_log)
    return build_day(readings, today, cw, log, _schedule(data, today), club=_club(data),
                     sources=_sources(data / "inbox" / today.isoformat()))

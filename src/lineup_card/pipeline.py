"""Read every inbox folder up to a date, clean, flag and build that day.

Baselines need history, so a run for one date reads all earlier inboxes.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from .adapters.catapult import read_catapult
from .adapters.vald import read_vald
from .adapters.wellness import read_wellness
from .clean import CleanLog, clean_catapult, clean_cmj, clean_wellness
from .crosswalk import Crosswalk
from .day import build_day


def _schedule(data: Path, today: date) -> dict:
    with (data / "schedule.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            if row["date"] == today.isoformat():
                return {"opponent": row["opponent"], "home_away": row["home_away"], "note": row["note"]}
    return {"opponent": "", "home_away": "", "note": ""}


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
    return build_day(readings, today, cw, log, _schedule(data, today))

"""Write API rows to the inbox CSVs in exactly the format the CSV readers read.

Each file is written to a temporary name in the same folder, then renamed,
so a failed pull never leaves half a CSV behind.
"""

from __future__ import annotations

import csv
import io
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .adapters.catapult import CatapultPeriod
from .adapters.vald import JUMP, RSI, CmjTrial

VALD_FILE = "vald_forcedecks_cmj.csv"
CATAPULT_FILE = "catapult_openfield.csv"
VALD_HEADER = ["Name", "ExternalId", "Date", "Time", "Test Type", "Trial",
               f"{JUMP[0]} [{JUMP[1]}]", f"{RSI[0]} [{RSI[1]}]"]
CATAPULT_HEADER = ["player_name", "period_name", "period_number", "start_time", "end_time",
                   "duration", "player_load", "throw_count", "pitch_count"]


def _cell(value) -> str:
    return "" if value is None else str(value)


def _utc(moment: datetime | None) -> str:
    if moment is None:
        return ""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def vald_csv(trials: list[CmjTrial]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(VALD_HEADER)
    for t in trials:
        w.writerow([t.name, t.external_id, t.day.isoformat(), getattr(t, "time", ""), "CMJ",
                    t.trial, _cell(t.jump_height_cm), _cell(t.rsi_mod)])
    return buf.getvalue()


def catapult_csv(periods: list[CatapultPeriod]) -> str:
    """Periods must carry start_utc (and end_utc when known), as the API reader's do."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(CATAPULT_HEADER)
    for p in periods:
        start, end = getattr(p, "start_utc", None), getattr(p, "end_utc", None)
        if start is None:
            raise ValueError("Catapult period has no start time; the reader needs one for the date")
        duration = int((end - start).total_seconds()) if end else None
        w.writerow([p.player_name, p.period_name, p.period_number, _utc(start), _utc(end),
                    _cell(duration), _cell(p.player_load), _cell(p.throw_count),
                    _cell(p.pitch_count)])
    return buf.getvalue()


def write_vald(folder: Path, trials: list[CmjTrial]) -> Path:
    path = folder / VALD_FILE
    atomic_write(path, vald_csv(trials))
    return path


def write_catapult(folder: Path, periods: list[CatapultPeriod]) -> Path:
    path = folder / CATAPULT_FILE
    atomic_write(path, catapult_csv(periods))
    return path

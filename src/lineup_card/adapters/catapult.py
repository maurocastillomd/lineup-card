"""Catapult OpenField CSV export -> one CatapultPeriod per row.

Column names are modeled on a public third-party import guide, not on
Catapult's own documentation. Times are UTC; the session date is the
club's local date, so a 7 p.m. game does not land on tomorrow.
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel

CLUB_TZ = ZoneInfo("America/Chicago")
REQUIRED = {"player_name", "period_name", "period_number", "start_time",
            "player_load", "throw_count", "pitch_count"}


class CatapultPeriod(BaseModel):
    player_name: str
    period_name: str
    period_number: int
    day: date
    player_load: float | None
    throw_count: int | None
    pitch_count: int | None


def _num(cell: str) -> float | None:
    cell = (cell or "").strip()
    return float(cell) if cell else None


def _int(cell: str) -> int | None:
    value = _num(cell)
    return None if value is None else int(value)


def local_day(utc_iso: str) -> date:
    stamp = datetime.fromisoformat(utc_iso.strip().replace("Z", "+00:00"))
    return stamp.astimezone(CLUB_TZ).date()


def read_catapult(path: Path) -> list[CatapultPeriod]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Catapult export is missing columns: " + ", ".join(sorted(missing)))
        return [CatapultPeriod(
            player_name=row["player_name"].strip(), period_name=row["period_name"].strip(),
            period_number=int(row["period_number"]), day=local_day(row["start_time"]),
            player_load=_num(row["player_load"]), throw_count=_int(row["throw_count"]),
            pitch_count=_int(row["pitch_count"])) for row in reader]

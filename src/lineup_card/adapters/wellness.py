"""Morning wellness form -> one WellnessRow per player.

Five items, 1 to 5, where 5 is best (for soreness, 5 = no soreness).
The score is the sum (5 to 25). A skipped item means no score that day.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from pydantic import BaseModel

ITEMS = ("sleep_quality", "soreness", "fatigue", "stress", "mood")


class WellnessRow(BaseModel):
    athlete_id: str
    day: date
    score: int | None


def read_wellness(path: Path) -> list[WellnessRow]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = {"athlete_id", "date", *ITEMS} - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Wellness file is missing columns: " + ", ".join(sorted(missing)))
        out = []
        for row in reader:
            cells = [row[item].strip() for item in ITEMS]
            score = None
            if all(cells):
                values = [int(c) for c in cells]
                if any(v < 1 or v > 5 for v in values):
                    raise ValueError("Wellness items must be 1 to 5")
                score = sum(values)
            out.append(WellnessRow(athlete_id=row["athlete_id"].strip(),
                                   day=date.fromisoformat(row["date"].strip()), score=score))
        return out

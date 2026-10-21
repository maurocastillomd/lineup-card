"""VALD ForceDecks CSV export -> one CmjTrial per row.

Column names are modeled on public examples; a club's Export Profile can
differ. Only CMJ rows are kept. A blank cell is missing, never zero.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from .headers import find_column

JUMP = ("Jump Height (Imp-Mom)", "cm")
RSI = ("RSI-modified", "m/s")
REQUIRED = {"Name", "ExternalId", "Date", "Test Type", "Trial"}


class CmjTrial(BaseModel):
    name: str
    external_id: str
    day: date
    trial: int
    jump_height_cm: float | None
    rsi_mod: float | None


def _num(cell: str) -> float | None:
    cell = cell.strip()
    return float(cell) if cell else None


def read_vald(path: Path) -> list[CmjTrial]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        missing = REQUIRED - set(headers)
        if missing:
            raise ValueError("VALD export is missing columns: " + ", ".join(sorted(missing)))
        jump_col = find_column(headers, *JUMP)
        rsi_col = find_column(headers, *RSI)
        out = []
        for row in reader:
            if row["Test Type"].strip().upper() != "CMJ":
                continue
            out.append(CmjTrial(
                name=row["Name"].strip(), external_id=row["ExternalId"].strip(),
                day=date.fromisoformat(row["Date"].strip()), trial=int(row["Trial"]),
                jump_height_cm=_num(row[jump_col]), rsi_mod=_num(row[rsi_col])))
        return out

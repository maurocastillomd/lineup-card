"""Write a fictional Triple-A roster and six weeks of vendor-shaped exports.

Every name is invented. Column names are modeled on public examples.
Run: .venv/bin/python scripts/generate_fictional.py
"""

from __future__ import annotations

import csv
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START, END = date(2026, 8, 10), date(2026, 9, 20)
TRAVEL_DAY = date(2026, 9, 15)
CALLUP_DAY = date(2026, 9, 12)
MISSPELL_FROM = date(2026, 9, 18)
SEED = 20261021

ROSTER = [  # lc_id, short name, full name, pos
    ("LC01", "J. Ortega", "Jorge Ortega", "RP"), ("LC02", "K. Ruiz", "Kevin Ruiz", "SP"),
    ("LC03", "T. Brandt", "Tyler Brandt", "OF"), ("LC04", "M. Daley", "Michael Daley", "C"),
    ("LC05", "A. Whitcomb", "Aaron Whitcomb", "SP"), ("LC06", "R. Okafor", "Ryan Okafor", "SP"),
    ("LC07", "D. Lindqvist", "Daniel Lindqvist", "SP"), ("LC08", "S. Marrero", "Samuel Marrero", "SP"),
    ("LC09", "P. Haddad", "Peter Haddad", "SP"), ("LC10", "L. Fenwick", "Luke Fenwick", "RP"),
    ("LC11", "E. Castellano", "Eric Castellano", "RP"), ("LC12", "B. Yamada", "Ben Yamada", "RP"),
    ("LC13", "C. Duvall", "Chris Duvall", "RP"), ("LC14", "G. Pruitt", "Grant Pruitt", "RP"),
    ("LC15", "H. Soto-Reyes", "Hector Soto-Reyes", "RP"), ("LC16", "N. Ambrose", "Nick Ambrose", "RP"),
    ("LC17", "O. Kessler", "Owen Kessler", "C"), ("LC18", "V. Ibarra", "Victor Ibarra", "C"),
    ("LC19", "W. Thorne", "Will Thorne", "IF"), ("LC20", "F. Quintero", "Felix Quintero", "IF"),
    ("LC21", "J. Mabry", "Jake Mabry", "IF"), ("LC22", "I. Novak", "Ivan Novak", "IF"),
    ("LC23", "Z. Pellegrino", "Zach Pellegrino", "IF"), ("LC24", "A. Boateng", "Andre Boateng", "IF"),
    ("LC25", "M. Serrano", "Marco Serrano", "OF"), ("LC26", "T. Gallagher", "Tom Gallagher", "OF"),
    ("LC27", "D. Achebe", "David Achebe", "OF"), ("LC28", "R. Vance", "Riley Vance", "OF"),
]
OPPONENTS = ["Fictional Visitors", "Lakeside Fictionals", "Prairie Placeholders", "Harbor Example Club"]


def _days():
    d = START
    while d <= END:
        if d.weekday() != 0:  # Mondays off
            yield d
        d += timedelta(days=1)


def _rsi_today(rng, base, noise, lc_id, day):
    value = rng.gauss(base, noise)
    if day == TRAVEL_DAY and lc_id != "LC03":  # Brandt stayed back for treatment
        value *= 0.92
    if lc_id == "LC01" and day >= date(2026, 9, 16):
        value *= 1 - 0.045 * ((day - date(2026, 9, 15)).days)
    if lc_id == "LC03" and day == END:
        value = base - 0.014
    return max(value, 0.2)


def generate(out: Path) -> None:
    rng = random.Random(SEED)
    out.mkdir(parents=True, exist_ok=True)
    with (out / "crosswalk.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lc_id", "name", "pos", "vald_external_id", "catapult_name"])
        for lc_id, short, full, pos in ROSTER:
            w.writerow([lc_id, short, pos, f"V{lc_id[2:]}0", full])

    profile = {lc_id: (rng.uniform(0.46, 0.62), rng.uniform(38, 47)) for lc_id, *_ in ROSTER}
    noise = {lc_id: 0.004 if lc_id == "LC03" else 0.028 for lc_id, *_ in ROSTER}

    with (out / "schedule.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "opponent", "home_away", "note"])
        for i, day in enumerate(_days()):
            note = "Road trip: 4 a.m. arrival" if day == TRAVEL_DAY else ""
            w.writerow([day.isoformat(), OPPONENTS[(i // 6) % len(OPPONENTS)],
                        "away" if (i // 6) % 2 else "home", note])

    for n, day in enumerate(_days()):
        folder = out / "inbox" / day.isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        active = [p for p in ROSTER if not (p[0] == "LC02" and day < CALLUP_DAY)]
        with (folder / "vald_forcedecks_cmj.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Name", "ExternalId", "Date", "Time", "Test Type", "Trial",
                        "Jump Height (Imp-Mom) [cm]", "RSI-modified [m/s]"])
            for lc_id, short, _, _ in active:
                base_rsi, base_jump = profile[lc_id]
                rsi = _rsi_today(rng, base_rsi, noise[lc_id], lc_id, day)
                jump = base_jump * rsi / base_rsi
                bad = rng.random() < 1 / 15 and lc_id != "LC03"
                for t in (1, 2, 3):
                    factor = 0.75 if bad and t == 3 else rng.gauss(1, 0.01 if lc_id == "LC03" else 0.02)
                    w.writerow([short, f"V{lc_id[2:]}0", day.isoformat(), f"07:{40 + t:02d}", "CMJ", t,
                                round(jump * factor, 1), round(rsi * factor, 3)])
        with (folder / "catapult_openfield.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["player_name", "period_name", "period_number", "start_time", "end_time",
                        "duration", "player_load", "throw_count", "pitch_count"])
            game = datetime(day.year, day.month, day.day, 23, 5, tzinfo=timezone.utc)  # 6:05 p.m. CT
            for lc_id, _, full, pos in active:
                name = "Mike Daley" if lc_id == "LC04" and day >= MISSPELL_FROM else full
                starts = pos == "SP" and (n + int(lc_id[2:])) % 5 == 0
                pitches = rng.randint(80, 100) if starts else (
                    rng.randint(12, 28) if pos == "RP" and rng.random() < 0.45 else 0)
                prep = rng.uniform(60, 90)
                game_load = rng.uniform(90, 160) if pos not in ("SP", "RP") or pitches else rng.uniform(20, 40)
                throws_prep = rng.randint(15, 35)
                throws_game = rng.randint(10, 60) if pos in ("C", "IF", "OF") else 0
                for k, (pname, start, load, throws, pc) in enumerate((
                        ("Warm-up", game - timedelta(hours=2), prep, throws_prep, 0),
                        ("Game", game, game_load, throws_game, pitches)), start=1):
                    w.writerow([name, pname, k, start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                (start + timedelta(minutes=50)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                3000, round(load, 1), throws, pc])
                w.writerow([name, "Session Total", 0, (game - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            game.strftime("%Y-%m-%dT%H:%M:%SZ"), 6000, round(prep + game_load, 1),
                            throws_prep + throws_game, pitches])
        with (folder / "wellness.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["athlete_id", "date", "sleep_quality", "soreness", "fatigue", "stress", "mood"])
            for lc_id, *_ in active:
                items = [min(5, max(1, round(rng.gauss(4.0, 0.6)))) for _ in range(5)]
                if lc_id == "LC01" and day >= date(2026, 9, 18):
                    items = [max(1, i - 1) for i in items]
                if day == TRAVEL_DAY:
                    items[0] = max(1, items[0] - 2)
                if rng.random() < 0.02:
                    items[1] = ""
                w.writerow([lc_id, day.isoformat(), *items])


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "fictional"
    generate(target)
    print(f"Wrote fictional data to {target}")

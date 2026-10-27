"""Write the Python day JSON for every fictional day with data.

The offline edition's JavaScript core must reproduce these files exactly
(tests/web/parity.test.mjs). Run after any change to src/lineup_card/:
    .venv/bin/python scripts/write_parity_golden.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_site import _has_rows  # noqa: E402
from lineup_card.pipeline import run_day  # noqa: E402

DATA = ROOT / "data" / "fictional"
OUT = ROOT / "tests" / "fixtures" / "parity"


def golden_days() -> dict[str, dict]:
    inbox = DATA / "inbox"
    dates = sorted(p.name for p in inbox.iterdir() if p.is_dir() and _has_rows(p))
    return {d: run_day(DATA, date.fromisoformat(d)) for d in dates}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    days = golden_days()
    for d, day in days.items():
        (OUT / f"{d}.json").write_text(json.dumps(day, indent=1, ensure_ascii=False))
    print(f"wrote {len(days)} golden days to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

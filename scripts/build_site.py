"""Run the pipeline for the last 14 game days and write web/data/.

Run: .venv/bin/python scripts/build_site.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from lineup_card.pipeline import run_day  # noqa: E402

DATA = ROOT / "data" / "fictional"
OUT = ROOT / "web" / "data"
SHOW_DAYS = 14


def main() -> None:
    dates = sorted(p.name for p in (DATA / "inbox").iterdir() if p.is_dir())[-SHOW_DAYS:]
    (OUT / "days").mkdir(parents=True, exist_ok=True)
    for d in dates:
        day = run_day(DATA, date.fromisoformat(d))
        (OUT / "days" / f"{d}.json").write_text(json.dumps(day, indent=1, ensure_ascii=False))
        print(f"{d}: {sum(p['status'] == 'check_in' for p in day['players'])} check in")
    (OUT / "index.json").write_text(json.dumps({"dates": dates, "latest": dates[-1]}, indent=1))


if __name__ == "__main__":
    main()

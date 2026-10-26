"""Run the pipeline for the last 14 game days and write the site data.

Run: .venv/bin/python scripts/build_site.py                      (fictional demo -> web/data/)
     .venv/bin/python scripts/build_site.py --data data/live     (real data -> data/live/site/)

Real data never goes into web/: a live build copies the web app into
<data>/site/ (git-ignored) and writes the day files there. A folder outside
data/live needs --allow-any-dir.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from lineup_card.paths import is_inside  # noqa: E402
from lineup_card.pipeline import run_day  # noqa: E402

FICTIONAL = ROOT / "data" / "fictional"
LIVE = ROOT / "data" / "live"
WEB = ROOT / "web"
SHOW_DAYS = 14


def _resolve(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else ROOT / p


def _has_rows(folder: Path) -> bool:
    """A day counts only if at least one export has a data row. Header-only
    files (an off day, or every vendor down) do not make an empty card."""
    for f in folder.glob("*.csv"):
        with f.open(encoding="utf-8-sig") as stream:
            if sum(1 for line in stream if line.strip()) > 1:
                return True
    return False


def build(data: Path, out: Path) -> list[str]:
    inbox = data / "inbox"
    if not inbox.is_dir():
        raise SystemExit(f"No inbox folder at {inbox}. Run scripts/pull.py first.")
    if not (data / "crosswalk.csv").exists():
        raise SystemExit(f"No crosswalk.csv in {data}. Make one before building (see README).")
    dates = sorted(p.name for p in inbox.iterdir() if p.is_dir() and _has_rows(p))[-SHOW_DAYS:]
    if not dates:
        raise SystemExit(f"No dated folders in {inbox}.")
    (out / "days").mkdir(parents=True, exist_ok=True)
    for d in dates:
        day = run_day(data, date.fromisoformat(d))
        (out / "days" / f"{d}.json").write_text(json.dumps(day, indent=1, ensure_ascii=False))
        print(f"{d}: {sum(p['status'] == 'check_in' for p in day['players'])} check in")
    (out / "index.json").write_text(json.dumps({"dates": dates, "latest": dates[-1]}, indent=1))
    return dates


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default=str(FICTIONAL.relative_to(ROOT)),
                        help="Data folder (default: data/fictional)")
    parser.add_argument("--allow-any-dir", action="store_true",
                        help="Allow real data outside data/live. That folder is not git-ignored.")
    args = parser.parse_args(argv)
    data = _resolve(args.data)
    if data.resolve() == FICTIONAL.resolve():
        build(data, WEB / "data")
        return
    if not is_inside(data, LIVE):
        if not args.allow_any_dir:
            raise SystemExit(f"Refusing to build real data in {data}: it is not under data/live, "
                             "which is git-ignored. Use data/live, or add --allow-any-dir if you are sure.")
        print(f"Warning: {data} is not under data/live, so it is not git-ignored. Never commit it.")
    site = data / "site"
    # The availability board is drawn for the fictional roster, so a live site leaves it out.
    shutil.copytree(WEB, site, dirs_exist_ok=True,
                    ignore=lambda folder, names: [n for n in names if n in ("data", "examples", "shots")
                                                  or (Path(folder) == WEB / "figures" and n == "board")])
    build(data, site / "data")
    print(f"Open it with: python3 -m http.server 8765 --directory {site}")


if __name__ == "__main__":
    main()

"""Pull VALD ForceDecks and Catapult OpenField data for a date into the inbox.

Writes the same CSVs a manual export would, so the rest of the pipeline is
unchanged. Credentials come only from environment variables.

Run:  .venv/bin/python scripts/pull.py --date 2026-09-20
      .venv/bin/python scripts/pull.py --date yesterday --to today --source all

Exit codes: 0 ok, 2 missing or bad settings (nothing written),
            3 vendor error (nothing written; message names the call and HTTP status).

Built to the vendors' published documents and tested against mocked replies.
Not yet tested against a live account.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from lineup_card.adapters.catapult import CLUB_TZ  # noqa: E402
from lineup_card.inbox import write_catapult, write_vald  # noqa: E402
from lineup_card.vendors.catapult_api import CatapultClient, CatapultSettings, pull_periods  # noqa: E402
from lineup_card.vendors.http import JsonClient, VendorError  # noqa: E402
from lineup_card.vendors.vald_api import ValdClient, ValdSettings, pull_cmj  # noqa: E402

DEFAULT_DATA = Path("data") / "live"
FICTIONAL = ROOT / "data" / "fictional"


def _day(text: str, today: date) -> date:
    words = {"today": today, "yesterday": today - timedelta(days=1)}
    if text in words:
        return words[text]
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{text}' is not YYYY-MM-DD, today or yesterday")


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Pull vendor data into data/<dir>/inbox/<date>/")
    p.add_argument("--date", default="today",
                   help="YYYY-MM-DD, today or yesterday (club time). Default: today")
    p.add_argument("--to", default=None, help="Last date of a range, inclusive. Default: same as --date")
    p.add_argument("--source", choices=("vald", "catapult", "all"), default="all")
    p.add_argument("--data", default=str(DEFAULT_DATA),
                   help="Data folder. Default: data/live (never the fictional demo)")
    return p


def _by_day(rows) -> dict[date, list]:
    out: dict[date, list] = {}
    for r in rows:
        out.setdefault(r.day, []).append(r)
    return out


def main(argv=None, env=None, transport=None, today: date | None = None, out=print) -> int:
    env = os.environ if env is None else env
    today = today or datetime.now(CLUB_TZ).date()
    args = _parser().parse_args(argv)
    try:
        first = _day(args.date, today)
        last = _day(args.to, today) if args.to else first
    except argparse.ArgumentTypeError as err:
        out(f"Bad date: {err}")
        return 2
    if last < first:
        out(f"--to ({last}) is before --date ({first})")
        return 2
    data = Path(args.data)
    data = data if data.is_absolute() else ROOT / data
    if data.resolve() == FICTIONAL.resolve():
        out("Refusing to write into data/fictional (the demo). Use --data data/live.")
        return 2

    sources = ("vald", "catapult") if args.source == "all" else (args.source,)
    settings, problems = {}, []
    if "vald" in sources:
        settings["vald"], missing = ValdSettings.from_env(env)
        problems += missing
    if "catapult" in sources:
        settings["catapult"], missing = CatapultSettings.from_env(env)
        problems += missing
    if problems:
        out("Missing or bad settings (set them as environment variables): " + ", ".join(problems))
        out("Nothing was written. See .env.example for the full list.")
        return 2

    until = last + timedelta(days=1)
    pulled = {}
    try:
        if "vald" in sources:
            client = ValdClient(settings["vald"], JsonClient("VALD", transport))
            pulled["vald"] = pull_cmj(client, first, until)
        if "catapult" in sources:
            client = CatapultClient(settings["catapult"], JsonClient("Catapult", transport))
            pulled["catapult"] = pull_periods(client, first, until)
    except VendorError as err:
        out(f"Vendor error: {err}")
        out("Nothing was written.")
        return 3
    except ValueError as err:     # a metric or unit the tool cannot use safely
        out(f"Vendor data problem: {err}")
        out("Nothing was written.")
        return 3

    span = first.isoformat() if first == last else f"{first.isoformat()} to {last.isoformat()}"
    for source, rows in pulled.items():
        write = write_vald if source == "vald" else write_catapult
        days = _by_day(rows)
        for day, day_rows in sorted(days.items()):
            write(data / "inbox" / day.isoformat(), day_rows)
        if source == "vald":
            players = {r.external_id for r in rows}
            what = f"{len(rows)} CMJ trials, {len(players)} players"
        else:
            players = {r.player_name for r in rows}
            what = f"{len(rows)} periods, {len(players)} players"
        where = ", ".join(d.isoformat() for d in sorted(days)) or "nothing written"
        out(f"{'VALD' if source == 'vald' else 'Catapult'} {span}: {what}; files: {where}")
        if source == "catapult":
            for note in settings["catapult"].notes():
                out(f"  note: {note}")
    out("Players not in crosswalk.csv are held out by the pipeline and listed in the review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Pull VALD ForceDecks and Catapult OpenField data for a date into the inbox.

Writes the same CSVs a manual export would, so the rest of the pipeline is
unchanged. Credentials come only from environment variables.

Run:  .venv/bin/python scripts/pull.py --date 2026-09-20
      .venv/bin/python scripts/pull.py --date yesterday --to today --source all

Each source is written as soon as it succeeds, one file per day in the range
(a day with no rows gets a header-only file, so a re-pull clears old rows).
A source that fails leaves its old files alone. Each day folder also gets
_status.json saying which source worked ("ok") or not ("failed"), so the card
can say which data is not from this morning.

Exit codes: 0 all sources ok.
            2 missing or bad settings, or a refused folder (nothing written).
            3 at least one source failed (vendor error, data problem or the time
              budget ran out). The message names which failed and which worked.

The whole pull stops after LINEUP_PULL_BUDGET_S seconds (default 900).

Built to the vendors' published documents and tested against mocked replies.
Not yet tested against a live account.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from lineup_card.adapters.catapult import CLUB_TZ  # noqa: E402
from lineup_card.inbox import atomic_write, write_catapult, write_vald  # noqa: E402
from lineup_card.paths import is_inside  # noqa: E402
from lineup_card.vendors.catapult_api import CatapultClient, CatapultSettings, pull_periods  # noqa: E402
from lineup_card.vendors.http import JsonClient, VendorError  # noqa: E402
from lineup_card.vendors.vald_api import ValdClient, ValdSettings, pull_cmj  # noqa: E402

DEFAULT_DATA = Path("data") / "live"
LIVE = ROOT / "data" / "live"
FICTIONAL = ROOT / "data" / "fictional"
DEFAULT_BUDGET_S = 15 * 60
STATUS_FILE = "_status.json"
NAMES = {"vald": "VALD", "catapult": "Catapult"}


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
    p.add_argument("--allow-any-dir", action="store_true",
                   help="Allow a data folder outside data/live. That folder is not git-ignored.")
    return p


def _by_day(rows) -> dict[date, list]:
    out: dict[date, list] = {}
    for r in rows:
        out.setdefault(r.day, []).append(r)
    return out


def _write_status(data: Path, days: list[date], results: dict[str, str]) -> None:
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for day in days:
        path = data / "inbox" / day.isoformat() / STATUS_FILE
        old = {}
        if path.exists():
            try:
                old = json.loads(path.read_text())
            except ValueError:
                old = {}
        old = old if isinstance(old, dict) else {}
        atomic_write(path, json.dumps({**old, **results, "pulled_at": stamp}, indent=1) + "\n")


def main(argv=None, env=None, transport=None, today: date | None = None, out=print,
         sleep=time.sleep, clock=time.monotonic) -> int:
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
    if is_inside(data, FICTIONAL):
        out("Refusing to write into data/fictional (the demo) or anything under it. Use --data data/live.")
        return 2
    outside_live = not is_inside(data, LIVE)
    if outside_live and not args.allow_any_dir:
        out(f"Refusing to write real data to {data}: it is not under data/live, which is git-ignored. "
            "Use data/live, or add --allow-any-dir if you are sure.")
        return 2

    sources = ("vald", "catapult") if args.source == "all" else (args.source,)
    settings, problems = {}, []
    if "vald" in sources:
        settings["vald"], missing = ValdSettings.from_env(env)
        problems += missing
    if "catapult" in sources:
        settings["catapult"], missing = CatapultSettings.from_env(env)
        problems += missing
    raw_budget = str(env.get("LINEUP_PULL_BUDGET_S", "")).strip()
    try:
        budget = float(raw_budget) if raw_budget else DEFAULT_BUDGET_S
        if budget <= 0:
            raise ValueError
    except ValueError:
        problems.append("LINEUP_PULL_BUDGET_S (seconds, a number above 0)")
    if problems:
        out("Missing or bad settings (set them as environment variables): " + ", ".join(problems))
        out("Nothing was written. See .env.example for the full list.")
        return 2

    if outside_live:
        out(f"Warning: {data} is not under data/live, so it is not git-ignored. Never commit it.")
    deadline = clock() + budget
    until = last + timedelta(days=1)
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    span = first.isoformat() if first == last else f"{first.isoformat()} to {last.isoformat()}"
    results: dict[str, str] = {}
    for source in sources:
        http = JsonClient(NAMES[source], transport, sleep=sleep, clock=clock, deadline=deadline)
        client = None
        try:
            if source == "vald":
                client = ValdClient(settings["vald"], http)
                rows = pull_cmj(client, first, until)
            else:
                client = CatapultClient(settings["catapult"], http)
                rows = pull_periods(client, first, until)
        except VendorError as err:
            out(f"{NAMES[source]} failed: {err}")
            results[source] = "failed"
            continue
        except ValueError as err:     # a metric or unit the tool cannot use safely
            out(f"{NAMES[source]} failed: data problem: {err}")
            results[source] = "failed"
            continue
        finally:
            for warning in getattr(client, "warnings", []):
                out(f"  warning: {warning}")

        write = write_vald if source == "vald" else write_catapult
        by_day = _by_day(rows)
        for day in days:
            write(data / "inbox" / day.isoformat(), by_day.get(day, []))
        if source == "vald":
            players = {r.external_id for r in rows}
            what = f"{len(rows)} CMJ trials, {len(players)} players"
        else:
            players = {r.player_name for r in rows}
            what = f"{len(rows)} periods, {len(players)} players"
        out(f"{NAMES[source]} {span}: {what}; files: {', '.join(d.isoformat() for d in days)}")
        if source == "catapult":
            for note in settings["catapult"].notes():
                out(f"  note: {note}")
        results[source] = "ok"

    _write_status(data, days, results)
    failed = [NAMES[s] for s in sources if results[s] == "failed"]
    worked = [NAMES[s] for s in sources if results[s] == "ok"]
    if failed:
        out(f"Finished with errors. Failed: {', '.join(failed)}."
            + (f" Succeeded: {', '.join(worked)}." if worked else "")
            + " Old files for a failed source were left as they were.")
        return 3
    out("Players not in crosswalk.csv are held out by the pipeline and listed in the review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

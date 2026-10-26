"""Catapult OpenField Cloud over its API -> the same CatapultPeriod rows the CSV reader gives.

Built to Catapult's own catapultR client source (see docs/api-sources.md);
Catapult's API docs site is not publicly readable. Not yet tested against a
live account.

Flow: activities around the club-day window -> one stats call
per activity grouped by athlete and period. Session-total rows are skipped,
like the cleaner does. Throw and pitch counts need account-specific
parameter slugs; without them those columns stay blank.
"""

from __future__ import annotations

import re
import urllib.parse
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from ..adapters.catapult import CLUB_TZ, CatapultPeriod
from .http import JsonClient

HOSTS = {"us": "us.catapultsports.com", "eu": "eu.catapultsports.com",
         "apac": "openfield.catapultsports.com"}
ALLOWED_SUFFIXES = (".catapultsports.com", ".catapultsports-cn.com")
_LABELS = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")
REQUIRED_ENV = ("CATAPULT_TOKEN", "CATAPULT_HOST")


def parse_host(raw: str) -> str | None:
    """us, eu, apac, a bare Catapult host name, or https://<that host>[/].
    Returns the host name, or None for anything else: another domain, a path,
    a query, a user name, a port, or a scheme other than https."""
    raw = raw.strip().lower()
    if raw in HOSTS:
        return HOSTS[raw]
    text = raw if "://" in raw else f"https://{raw}"
    try:
        parts = urllib.parse.urlsplit(text)
        port = parts.port
    except ValueError:
        return None
    host = parts.hostname or ""
    if (parts.scheme != "https" or port is not None or parts.username is not None
            or parts.password is not None or parts.netloc != host
            or parts.path not in ("", "/") or parts.query or parts.fragment
            or "#" in text or "?" in text):
        return None
    if not _LABELS.match(host) or not any(host.endswith(sfx) for sfx in ALLOWED_SUFFIXES):
        return None
    return host
DEFAULT_LOAD_SLUG = "total_player_load"


@dataclass
class CatapultSettings:
    token: str
    host: str
    load_slug: str = DEFAULT_LOAD_SLUG
    throw_slug: str = ""
    pitch_slug: str = ""

    @classmethod
    def from_env(cls, env) -> tuple["CatapultSettings | None", list[str]]:
        problems = [k for k in REQUIRED_ENV if not env.get(k, "").strip()]
        raw = env.get("CATAPULT_HOST", "").strip()
        host = parse_host(raw) if raw else None
        if raw and host is None:
            problems.append("CATAPULT_HOST (us, eu, apac, or a *.catapultsports.com host name "
                            "with https and no path or port)")
        if problems:
            return None, problems
        return cls(env["CATAPULT_TOKEN"].strip(), host,
                   env.get("CATAPULT_LOAD_SLUG", "").strip() or DEFAULT_LOAD_SLUG,
                   env.get("CATAPULT_THROW_SLUG", "").strip(),
                   env.get("CATAPULT_PITCH_SLUG", "").strip()), []

    @property
    def base(self) -> str:
        return f"https://{self.host}/api/v6"

    def notes(self) -> list[str]:
        out = []
        if not self.throw_slug:
            out.append("CATAPULT_THROW_SLUG not set: throw_count left blank")
        if not self.pitch_slug:
            out.append("CATAPULT_PITCH_SLUG not set: pitch_count left blank")
        return out


def club_midnight_epoch(day: date) -> int:
    return int(datetime.combine(day, time(0), tzinfo=CLUB_TZ).timestamp())


def _epoch(value) -> datetime | None:
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(float(value), tz=timezone.utc)


def _num(value) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


class CatapultClient:
    def __init__(self, settings: CatapultSettings, http: JsonClient):
        self.s, self.http = settings, http

    def activities(self, since: date, until: date) -> list[dict]:
        reply = self.http.request("GET", f"{self.s.base}/activities", bearer=self.s.token,
                                  params={"startTime": club_midnight_epoch(since),
                                          "endTime": club_midnight_epoch(until)},
                                  call="GET /api/v6/activities")
        return (None if reply.status == 204 else reply.json()) or []

    def parameters(self) -> list[str]:
        return [p for p in (self.s.load_slug, self.s.throw_slug, self.s.pitch_slug) if p]

    def stats_body(self, activity_id) -> dict:
        return {"filters": [{"name": "activity_id", "comparison": "=", "values": [str(activity_id)]}],
                "parameters": self.parameters(), "group_by": ["athlete", "period"]}

    def stats(self, activity_id) -> list[dict]:
        reply = self.http.request("POST", f"{self.s.base}/stats", bearer=self.s.token,
                                  params={"requested_only": "TRUE"},
                                  json_body=self.stats_body(activity_id),
                                  call="POST /api/v6/stats")
        return (None if reply.status == 204 else reply.json()) or []


class ApiCatapultPeriod(CatapultPeriod):
    """A CatapultPeriod plus the UTC start and end the CSV carries."""
    start_utc: datetime
    end_utc: datetime | None = None


def pull_periods(client: CatapultClient, since: date, until: date) -> list[ApiCatapultPeriod]:
    """Athlete periods that start on local days since <= day < until.

    The day comes from each period's own start time, the same rule the CSV
    reader uses. Activities are fetched from one day earlier so a period that
    starts after midnight is found when that next day is pulled."""
    s = client.s
    acts = []
    for a in client.activities(since - timedelta(days=1), until):
        start = _epoch(a.get("start_time"))
        if start:
            acts.append((start, a))
    acts.sort(key=lambda pair: (pair[0], str(pair[1].get("id"))))

    rows_by_day: dict[date, list[tuple]] = defaultdict(list)
    for act_start, act in acts:
        for row in client.stats(act["id"]):
            if "total" in str(row.get("period_name") or "").lower():
                continue
            start = _epoch(row.get("start_time")) or act_start
            day = start.astimezone(CLUB_TZ).date()
            if since <= day < until:
                rows_by_day[day].append((act_start, str(act.get("id")), start, row))

    out: list[ApiCatapultPeriod] = []
    for day, rows in sorted(rows_by_day.items()):
        # Number periods by start time within each activity. When a day has more than
        # one activity, numbering continues, so the cleaner's (player, day, period)
        # duplicate check never merges two different sessions.
        first_start: dict[tuple, tuple] = {}
        for act_start, act_id, start, row in rows:
            key = (act_id, str(row.get("period_id") or row.get("period_name")))
            first_start[key] = min(first_start.get(key, (act_start, start)), (act_start, start))
        number = {key: n for n, key in enumerate(sorted(first_start, key=first_start.get), start=1)}
        for act_start, act_id, start, row in sorted(rows, key=lambda r: (r[0], r[2])):
            key = (act_id, str(row.get("period_id") or row.get("period_name")))
            throws = _num(row.get(s.throw_slug)) if s.throw_slug else None
            pitches = _num(row.get(s.pitch_slug)) if s.pitch_slug else None
            out.append(ApiCatapultPeriod(
                player_name=str(row.get("athlete_name") or "").strip(),
                period_name=str(row.get("period_name") or "").strip(),
                period_number=number[key], day=day,
                player_load=_num(row.get(s.load_slug)),
                throw_count=None if throws is None else int(throws),
                pitch_count=None if pitches is None else int(pitches),
                start_utc=start, end_utc=_epoch(row.get("end_time"))))
    return out

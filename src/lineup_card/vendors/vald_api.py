"""VALD ForceDecks over the External API -> the same CmjTrial rows the CSV reader gives.

Built to VALD's published Swagger and support guides (see docs/api-sources.md).
Not yet tested against a live account.

Flow: token (cached) -> profiles (names and External IDs) -> result definitions
(find jump height and RSI-modified by name) -> tests modified since the start
(paged until 204) -> trials for each CMJ test in the date window.
"""

from __future__ import annotations

import difflib
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from ..adapters.vald import CmjTrial
from .http import JsonClient, VendorError

AUTH_URL = "https://auth.prd.vald.com/oauth/token"
AUDIENCE = "vald-api-external"
REGIONS = ("use", "aue", "euw")
DEFAULT_JUMP = ("Jump Height (Imp-Mom)",)
DEFAULT_RSI = ("RSI-modified", "RSI_MODIFIED")
WHOLE_BODY_LIMBS = {"Trial", "Both"}

# resultUnit (VALD UnitType) -> factor to the CSV unit. Anything else stops the pull.
TO_CM = {"Centimeter": 1.0, "Meter": 100.0, "Millimeter": 0.1, "Inch": 2.54}
TO_M_PER_S = {"MeterPerSecond": 1.0, "RSIModified": 1.0,
              "CentimeterPerSecond": 0.01, "MillimeterPerSecond": 0.001}

DEFAULT_TOKEN_SECONDS = 300   # used when the token reply has no expires_in
REQUIRED_ENV = ("VALD_CLIENT_ID", "VALD_CLIENT_SECRET", "VALD_TENANT_ID", "VALD_REGION")


@dataclass
class ValdSettings:
    client_id: str
    client_secret: str
    tenant_id: str
    region: str
    cmj_test_type: str = "CMJ"
    jump_names: tuple[str, ...] = DEFAULT_JUMP
    rsi_names: tuple[str, ...] = DEFAULT_RSI

    @classmethod
    def from_env(cls, env) -> tuple["ValdSettings | None", list[str]]:
        """Return (settings, problems). Problems name the env vars to fix."""
        problems = [k for k in REQUIRED_ENV if not env.get(k, "").strip()]
        region = env.get("VALD_REGION", "").strip().lower()
        if region and region not in REGIONS:
            problems.append(f"VALD_REGION (must be one of {', '.join(REGIONS)}, got '{region}')")
        if problems:
            return None, problems

        def names(key, default):
            raw = env.get(key, "").strip()
            return tuple(n.strip() for n in raw.split("|") if n.strip()) if raw else default

        return cls(env["VALD_CLIENT_ID"].strip(), env["VALD_CLIENT_SECRET"].strip(),
                   env["VALD_TENANT_ID"].strip(), region,
                   env.get("VALD_CMJ_TEST_TYPE", "").strip() or "CMJ",
                   names("VALD_JUMP_RESULT", DEFAULT_JUMP),
                   names("VALD_RSI_RESULT", DEFAULT_RSI)), []

    @property
    def forcedecks(self) -> str:
        return f"https://prd-{self.region}-api-extforcedecks.valdperformance.com"

    @property
    def profiles_host(self) -> str:
        return f"https://prd-{self.region}-api-externalprofile.valdperformance.com"


def parse_utc(stamp: str) -> datetime:
    """VALD times look like 2024-06-17T05:23:52.940Z. Trim long fractions."""
    text = stamp.strip().replace("Z", "+00:00")
    if "." in text:
        head, rest = text.split(".", 1)
        digits = "".join(c for c in rest if c.isdigit())
        tz = rest[len(digits):]
        text = f"{head}.{digits[:6].ljust(6, '0')}{tz}"
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _cursor(moment: datetime) -> str:
    """UTC time as VALD's modifiedFromUtc wants it, to the millisecond."""
    utc = moment.astimezone(timezone.utc)
    return f"{utc:%Y-%m-%dT%H:%M:%S}.{utc.microsecond // 1000:03d}Z"


def local_time(utc: str, offset_minutes: int | None) -> datetime:
    """recordedOffset is minutes to add to the UTC time (VALD guide)."""
    return (parse_utc(utc) + timedelta(minutes=offset_minutes or 0)).replace(tzinfo=None)


class ValdClient:
    def __init__(self, settings: ValdSettings, http: JsonClient, clock=time.time):
        self.s, self.http, self.clock = settings, http, clock
        self.warnings: list[str] = []
        self._token: str | None = None
        self._expires_at = 0.0

    def token(self) -> str:
        """Token requests are rate limited, so reuse it until a minute before expiry."""
        if self._token and self.clock() < self._expires_at - 60:
            return self._token
        reply = self.http.request("POST", AUTH_URL, call="POST oauth/token (VALD token)", form={
            "grant_type": "client_credentials", "client_id": self.s.client_id,
            "client_secret": self.s.client_secret, "audience": AUDIENCE}).json() or {}
        if not reply.get("access_token"):
            raise VendorError("VALD token reply had no access_token", None, "POST oauth/token")
        self._token = reply["access_token"]
        self._expires_at = self.clock() + float(reply.get("expires_in") or DEFAULT_TOKEN_SECONDS)
        return self._token

    def _get(self, url: str, params: dict | None = None, call: str = ""):
        reply = self.http.request("GET", url, params=params, bearer=self.token(), call=call)
        return None if reply.status == 204 else reply.json()

    def profiles(self) -> dict[str, dict]:
        data = self._get(f"{self.s.profiles_host}/profiles", {"tenantId": self.s.tenant_id},
                         "GET /profiles") or {}
        return {p["profileId"]: p for p in data.get("profiles") or []}

    def result_definitions(self) -> list[dict]:
        data = self._get(f"{self.s.forcedecks}/resultdefinitions", None,
                         "GET /resultdefinitions") or {}
        return data.get("resultDefinitions") or []

    def tests(self, modified_from: datetime, max_pages: int = 1000) -> list[dict]:
        """Page by moving modifiedFromUtc to the last test's modifiedDateUtc until 204.
        A page may repeat the last test, so tests are de-duplicated by testId.

        If a page ends on the time it was asked from (several tests share one
        modifiedDateUtc, or the last test repeats), asking again would return the
        same page forever. The cursor then moves 1 ms past that time. When more
        than one test shares the time, a warning names it, because tests with that
        same time beyond this page cannot be reached."""
        cursor = _cursor(modified_from)
        seen: dict[str, dict] = {}
        for _ in range(max_pages):
            data = self._get(f"{self.s.forcedecks}/tests",
                             {"tenantId": self.s.tenant_id, "modifiedFromUtc": cursor},
                             "GET /tests")
            page = (data or {}).get("tests") or []
            if not page:
                break
            for t in page:
                seen[t["testId"]] = t
            last, at = parse_utc(page[-1]["modifiedDateUtc"]), parse_utc(cursor)
            if last > at:
                cursor = page[-1]["modifiedDateUtc"]
            elif last < at:
                break   # nothing newer than the cursor came back; nothing more to read
            else:
                if len(page) > 1:
                    self.warnings.append(
                        f"VALD /tests: {len(page)} tests share modifiedDateUtc {cursor}; moved 1 ms "
                        "past it. Any more tests with that exact time beyond this page were not read.")
                cursor = _cursor(last + timedelta(milliseconds=1))
        else:
            raise VendorError(f"VALD /tests did not finish after {max_pages} pages", None, "GET /tests")
        return list(seen.values())

    def trials(self, test_id: str) -> list[dict]:
        url = f"{self.s.forcedecks}/v2019q3/teams/{self.s.tenant_id}/tests/{test_id}/trials"
        return self._get(url, None, "GET /v2019q3/teams/{tenantId}/tests/{testId}/trials") or []


def find_definition(definitions: list[dict], wanted: tuple[str, ...], label: str) -> dict:
    """Match resultName or resultIdString (or a numeric resultId) exactly, ignoring case.
    If none match exactly, accept a single definition whose name contains the wanted
    text. Anything else stops with the closest names, so a wrong metric is never used."""
    keys = {w.lower() for w in wanted}
    exact = [d for d in definitions
             if str(d.get("resultName", "")).lower() in keys
             or str(d.get("resultIdString", "")).lower() in keys
             or str(d.get("resultId", "")) in keys]
    if len(exact) == 1:
        return exact[0]
    contains = [d for d in definitions
                if any(k in str(d.get("resultName", "")).lower() for k in keys)]
    if not exact and len(contains) == 1:
        return contains[0]
    names = [f"{d.get('resultName')} ({d.get('resultIdString')}, id {d.get('resultId')})"
             for d in definitions if d.get("resultName")]
    found = exact or contains
    if found:
        listed = "; ".join(f"{d.get('resultName')} ({d.get('resultIdString')}, id {d.get('resultId')})"
                           for d in found)
        raise ValueError(f"VALD {label}: more than one result definition matches {list(wanted)}: "
                         f"{listed}. Set the exact name, idString or id in the environment.")
    close = difflib.get_close_matches(wanted[0], names, n=5, cutoff=0.3)
    close += [n for n in names if label.split()[0].lower() in n.lower() and n not in close][:5]
    raise ValueError(f"VALD {label}: no result definition named {list(wanted)}. "
                     f"Closest: {'; '.join(close) or 'none'}. Set the exact name in the environment.")


def unit_factor(definition: dict, table: dict[str, float], csv_unit: str) -> float:
    """Factor from the raw API value to the CSV unit: scale factor x unit conversion."""
    unit = definition.get("resultUnit")
    if unit not in table:
        raise ValueError(f"VALD '{definition.get('resultName')}' is in {unit} "
                         f"({definition.get('resultUnitName')}); this tool only knows how to turn "
                         f"{', '.join(table)} into [{csv_unit}]. Stopped so no wrong units are written.")
    scale = definition.get("resultUnitScaleFactor")
    return (1.0 if scale is None else float(scale)) * table[unit]


@dataclass
class _Metric:
    result_id: int
    factor: float


def _value(trial: dict, metric: _Metric) -> float | None:
    for r in trial.get("results") or []:
        if (r.get("resultId") == metric.result_id and r.get("limb") in WHOLE_BODY_LIMBS
                and not r.get("repeat")):
            return None if r.get("value") is None else float(r["value"]) * metric.factor
    return None


class ApiCmjTrial(CmjTrial):
    """A CmjTrial plus the local clock time, written to the CSV Time column."""
    time: str = ""


def pull_cmj(client: ValdClient, since: date, until: date) -> list[ApiCmjTrial]:
    """CMJ trials recorded on local days since <= day < until."""
    s = client.s
    definitions = client.result_definitions()
    jump_def = find_definition(definitions, s.jump_names, "jump height")
    rsi_def = find_definition(definitions, s.rsi_names, "RSI-modified")
    jump = _Metric(jump_def["resultId"], unit_factor(jump_def, TO_CM, "cm"))
    rsi = _Metric(rsi_def["resultId"], unit_factor(rsi_def, TO_M_PER_S, "m/s"))

    # A test is modified at or after it is recorded; a day early covers time zones.
    start = datetime(since.year, since.month, since.day, tzinfo=timezone.utc) - timedelta(days=1)
    wanted = s.cmj_test_type.strip().lower()
    tests = [t for t in client.tests(start)
             if str(t.get("testType") or "").strip().lower() == wanted
             and since <= local_time(t["recordedDateUtc"], t.get("recordedDateOffset")).date() < until]
    if not tests:
        return []
    profiles = client.profiles()

    out: list[ApiCmjTrial] = []
    for test in sorted(tests, key=lambda t: (t["recordedDateUtc"], t["testId"])):
        profile = profiles.get(test["profileId"], {})
        name = " ".join(p for p in (profile.get("givenName"), profile.get("familyName")) if p)
        external_id = (profile.get("externalId") or "").strip() or test["profileId"]
        day = local_time(test["recordedDateUtc"], test.get("recordedDateOffset")).date()
        trials = sorted(client.trials(test["testId"]),
                        key=lambda tr: (tr.get("recordedUTC") or "", tr.get("id") or ""))
        for n, trial in enumerate(trials, start=1):
            when = local_time(trial["recordedUTC"], trial.get("recordedOffset")) \
                if trial.get("recordedUTC") else None
            out.append(ApiCmjTrial(
                name=name or test["profileId"], external_id=external_id, day=day, trial=n,
                jump_height_cm=_value(trial, jump), rsi_mod=_value(trial, rsi),
                time=when.strftime("%H:%M") if when else ""))
    return out

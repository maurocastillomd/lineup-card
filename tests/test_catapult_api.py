import json
import urllib.parse
from datetime import date, datetime, timezone

import pytest
from fakes import FakeTransport, fixture, ok, status

from lineup_card.vendors.catapult_api import (CatapultClient, CatapultSettings, club_midnight_epoch,
                                              pull_periods)
from lineup_card.vendors.http import JsonClient, VendorError

ENV = {"CATAPULT_TOKEN": "fake-cat-token", "CATAPULT_HOST": "us"}


def make(env=None):
    t = FakeTransport()
    t.on("GET", "/api/v6/activities", ok(fixture("catapult_activities.json")))
    files = {"act-game-0920": "catapult_stats_game_0920.json",
             "act-lift-0920": "catapult_stats_lift_0920.json",
             "act-game-0919": "catapult_stats_game_0919.json"}

    def call(method, url, headers, body):
        if method == "POST":
            t.calls.append({"method": method, "url": url, "headers": dict(headers), "body": body})
            return ok(fixture(files[json.loads(body)["filters"][0]["values"][0]]))
        return FakeTransport.__call__(t, method, url, headers, body)
    s, problems = CatapultSettings.from_env({**ENV, **(env or {})})
    assert problems == []
    return t, CatapultClient(s, JsonClient("Catapult", call, sleep=lambda x: None))


def test_activities_window_is_club_midnights_in_epoch_seconds():
    t, c = make()
    c.activities(date(2026, 9, 20), date(2026, 9, 21))
    call = t.calls[0]
    parts = urllib.parse.urlsplit(call["url"])
    assert parts.netloc == "us.catapultsports.com" and parts.path == "/api/v6/activities"
    # 2026-09-20 00:00 and 2026-09-21 00:00 in Chicago (CDT, UTC-5)
    assert dict(urllib.parse.parse_qsl(parts.query)) == {"startTime": "1789880400", "endTime": "1789966800"}
    assert call["headers"]["Authorization"] == "Bearer fake-cat-token"
    assert club_midnight_epoch(date(2026, 9, 20)) == int(
        datetime(2026, 9, 20, 5, tzinfo=timezone.utc).timestamp())


def test_stats_request_body_is_exact():
    t, c = make({"CATAPULT_THROW_SLUG": "fake_throw_count"})
    c.stats("act-game-0920")
    call = t.calls[0]
    assert urllib.parse.urlsplit(call["url"]).query == "requested_only=TRUE"
    assert json.loads(call["body"]) == {
        "filters": [{"name": "activity_id", "comparison": "=", "values": ["act-game-0920"]}],
        "parameters": ["total_player_load", "fake_throw_count"],
        "group_by": ["athlete", "period"]}
    assert call["headers"]["Content-Type"] == "application/json"


def test_pull_numbers_periods_skips_totals_and_keeps_local_day():
    t, c = make({"CATAPULT_THROW_SLUG": "fake_throw_count"})
    rows = pull_periods(c, date(2026, 9, 20), date(2026, 9, 21))
    got = [(r.player_name, r.period_name, r.period_number) for r in rows]
    assert got == [
        ("Jorge Ortega", "Extra innings", 1),   # 12:10 a.m. on 9/20 from the 9/19 game
        ("Jorge Ortega", "Early work", 2),
        ("Jorge Ortega", "Warm-up", 3), ("Kevin Ruiz", "Warm-up", 3),
        ("Jorge Ortega", "Game", 4)]
    assert all(r.day == date(2026, 9, 20) for r in rows)
    assert not any("total" in r.period_name.lower() for r in rows)
    ruiz = rows[3]
    assert ruiz.player_load == 64.5 and ruiz.throw_count == 18 and ruiz.pitch_count is None
    game = rows[4]
    assert game.start_utc == datetime(2026, 9, 20, 23, 5, tzinfo=timezone.utc)
    assert (game.end_utc - game.start_utc).total_seconds() == 12300
    # activities fetched from a day early so after-midnight periods are found
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(t.calls[0]["url"]).query))
    assert query["startTime"] == str(club_midnight_epoch(date(2026, 9, 19)))


def test_without_slugs_throw_and_pitch_are_blank():
    t, c = make()
    rows = pull_periods(c, date(2026, 9, 20), date(2026, 9, 21))
    assert all(r.throw_count is None and r.pitch_count is None for r in rows)
    assert c.s.notes() == ["CATAPULT_THROW_SLUG not set: throw_count left blank",
                           "CATAPULT_PITCH_SLUG not set: pitch_count left blank"]


def test_401_is_clear():
    t = FakeTransport().on("GET", "/api/v6/activities", status(401, "Unauthenticated."))
    s, _ = CatapultSettings.from_env(ENV)
    c = CatapultClient(s, JsonClient("Catapult", t, sleep=lambda x: None))
    with pytest.raises(VendorError, match="Catapult refused the credentials \\(HTTP 401\\) on GET /api/v6/activities"):
        c.activities(date(2026, 9, 20), date(2026, 9, 21))


def test_settings_problems_and_hosts():
    s, problems = CatapultSettings.from_env({"CATAPULT_HOST": "example.com"})
    assert s is None and problems[0] == "CATAPULT_TOKEN" and "CATAPULT_HOST" in problems[1]
    s, _ = CatapultSettings.from_env({"CATAPULT_TOKEN": "x", "CATAPULT_HOST": "apac"})
    assert s.base == "https://openfield.catapultsports.com/api/v6"


@pytest.mark.parametrize("raw, host", [
    ("us", "us.catapultsports.com"), ("EU", "eu.catapultsports.com"),
    ("apac", "openfield.catapultsports.com"),
    ("connect-us.catapultsports.com", "connect-us.catapultsports.com"),
    ("https://connect-us.catapultsports.com", "connect-us.catapultsports.com"),
    ("https://connect-us.catapultsports.com/", "connect-us.catapultsports.com"),
    ("backend-cn.catapultsports-cn.com", "backend-cn.catapultsports-cn.com"),
])
def test_catapult_host_accepted(raw, host):
    s, problems = CatapultSettings.from_env({**ENV, "CATAPULT_HOST": raw})
    assert problems == [] and s.host == host and s.base == f"https://{host}/api/v6"


@pytest.mark.parametrize("raw", [
    "evil.com/.catapultsports.com",
    "evil.com#.catapultsports.com",
    "evil.com?.catapultsports.com",
    "us.catapultsports.com@evil.com",
    "user@us.catapultsports.com",
    "https://user:pw@us.catapultsports.com",
    "us.catapultsports.com:8443",
    "https://us.catapultsports.com:443",
    "http://us.catapultsports.com",
    "ftp://us.catapultsports.com",
    "https://us.catapultsports.com/api",
    "us.catapultsports.com.evil.com",
    "evilcatapultsports.com",
    ".catapultsports.com",
    "evil.com\\.catapultsports.com",
    "evil .catapultsports.com",
])
def test_catapult_host_evil_cases_refused(raw):
    s, problems = CatapultSettings.from_env({**ENV, "CATAPULT_HOST": raw})
    assert s is None and any("CATAPULT_HOST" in p for p in problems)

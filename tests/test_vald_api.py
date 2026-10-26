import urllib.parse
from datetime import date, datetime, timezone

import pytest
from fakes import FakeTransport, fixture, ok, status

from lineup_card.vendors.http import JsonClient, VendorError
from lineup_card.vendors.vald_api import (ValdClient, ValdSettings, find_definition, local_time,
                                          pull_cmj, unit_factor, TO_CM)

ENV = {"VALD_CLIENT_ID": "id-1", "VALD_CLIENT_SECRET": "secret-1",
       "VALD_TENANT_ID": "99999999-9999-9999-9999-999999999999", "VALD_REGION": "use"}
FD = "https://prd-use-api-extforcedecks.valdperformance.com"
TESTS = "aaaaaaaa-0000-0000-0000-00000000000"


def settings(**extra):
    s, problems = ValdSettings.from_env({**ENV, **extra})
    assert problems == []
    return s


def full_transport():
    t = FakeTransport()
    t.on("POST", "/oauth/token", ok(fixture("vald_token.json")))
    t.on("GET", "/profiles", ok(fixture("vald_profiles.json")))
    t.on("GET", "/resultdefinitions", ok(fixture("vald_resultdefinitions.json")))
    t.on("GET", "/tests", ok(fixture("vald_tests_page1.json")), modifiedFromUtc="2026-09-19T00:00:00.000Z")
    t.on("GET", "/tests", ok(fixture("vald_tests_page2.json")), modifiedFromUtc="2026-09-20T12:50:00.000Z")
    t.on("GET", "/tests", status(204), modifiedFromUtc="2026-09-21T15:00:00.000Z")
    t.on("GET", f"/tests/{TESTS}1/trials", ok(fixture("vald_trials_test1.json")))
    t.on("GET", f"/tests/{TESTS}3/trials", ok(fixture("vald_trials_test3.json")))
    return t


def make_client(t, clock=lambda: 1000.0, **extra):
    return ValdClient(settings(**extra), JsonClient("VALD", t, sleep=lambda s: None), clock=clock)


def test_token_request_url_and_form_body():
    t = full_transport()
    make_client(t).token()
    call = t.calls[0]
    assert call["url"] == "https://auth.prd.vald.com/oauth/token"
    assert call["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert dict(urllib.parse.parse_qsl(call["body"].decode())) == {
        "grant_type": "client_credentials", "client_id": "id-1",
        "client_secret": "secret-1", "audience": "vald-api-external"}


def test_token_reused_until_expiry_then_refreshed():
    now = [1000.0]
    t = full_transport()
    c = make_client(t, clock=lambda: now[0])
    assert c.token() == "fake-token-1"
    now[0] += 7000            # still more than a minute left of 7200 s
    c.token()
    assert t.paths().count("/oauth/token") == 1
    now[0] += 200             # past expiry
    c.token()
    assert t.paths().count("/oauth/token") == 2


def test_401_on_tests_is_clear():
    t = FakeTransport().on("POST", "/oauth/token", ok(fixture("vald_token.json")))
    t.on("GET", "/tests", status(401))
    with pytest.raises(VendorError, match="VALD refused the credentials \\(HTTP 401\\) on GET /tests"):
        make_client(t).tests(datetime(2026, 9, 19, tzinfo=timezone.utc))


def test_tests_paged_until_204_with_dedupe():
    t = full_transport()
    tests = make_client(t).tests(datetime(2026, 9, 19, tzinfo=timezone.utc))
    assert [x["testId"][-1] for x in tests] == ["1", "2", "3", "4"]
    test_calls = [c for c in t.calls if urllib.parse.urlsplit(c["url"]).path == "/tests"]
    assert len(test_calls) == 3
    assert all(c["headers"]["Authorization"] == "Bearer fake-token-1" for c in test_calls)
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(test_calls[0]["url"]).query))
    assert query == {"tenantId": ENV["VALD_TENANT_ID"], "modifiedFromUtc": "2026-09-19T00:00:00.000Z"}


def test_paging_stops_when_the_api_repeats_the_same_last_test():
    t = FakeTransport().on("POST", "/oauth/token", ok(fixture("vald_token.json")))
    page = {"tests": fixture("vald_tests_page1.json")["tests"][:1]}
    t.on("GET", "/tests", ok(page))
    start = datetime(2026, 9, 20, 12, 45, 0, 120000, tzinfo=timezone.utc)
    tests = make_client(t).tests(start)
    assert len(tests) == 1


def test_pull_cmj_window_types_scale_and_numbering():
    t = full_transport()
    rows = pull_cmj(make_client(t), date(2026, 9, 20), date(2026, 9, 21))
    # QSB test skipped, next-day test skipped, late-evening test kept on its local day
    assert [(r.name, r.trial) for r in rows] == [
        ("Jorge Ortega", 1), ("Jorge Ortega", 2), ("Jorge Ortega", 3),
        ("Kevin Ruiz", 1), ("Kevin Ruiz", 2)]
    first = rows[0]
    assert first.external_id == "V010" and first.day == date(2026, 9, 20) and first.time == "07:41"
    assert first.jump_height_cm == pytest.approx(41.2)     # 0.412 m x scale 100 -> cm
    assert first.rsi_mod == pytest.approx(0.523)
    assert [r.jump_height_cm for r in rows[:3]] == pytest.approx([41.2, 40.9, 40.5])
    ruiz = rows[3]
    assert ruiz.external_id == "22222222-2222-2222-2222-222222222222"   # no externalId: profileId
    assert ruiz.day == date(2026, 9, 20) and ruiz.time == "22:31"
    assert ruiz.rsi_mod is None                                          # missing stays missing
    assert "/tests/aaaaaaaa-0000-0000-0000-000000000002/trials" not in " ".join(t.paths())


def test_cmj_test_type_is_configurable():
    t = full_transport()
    assert pull_cmj(make_client(t, VALD_CMJ_TEST_TYPE="CMJX"), date(2026, 9, 20), date(2026, 9, 21)) == []


def test_unknown_result_name_gives_clear_error():
    defs = fixture("vald_resultdefinitions.json")["resultDefinitions"]
    with pytest.raises(ValueError, match="no result definition named \\['Jump Height \\(Imp-Mom\\) \\[cm\\]'\\]. Closest:.*Jump Height \\(Imp-Mom\\)"):
        find_definition(defs, ("Jump Height (Imp-Mom) [cm]",), "jump height")


def test_exact_name_beats_longer_names():
    defs = fixture("vald_resultdefinitions.json")["resultDefinitions"]
    assert find_definition(defs, ("Jump Height (Imp-Mom)",), "jump height")["resultId"] == 900001
    assert find_definition(defs, ("RSI-modified", "RSI_MODIFIED"), "RSI-modified")["resultId"] == 900003
    assert find_definition(defs, ("900002",), "jump height")["resultUnit"] == "Inch"


def test_ambiguous_partial_name_stops():
    defs = fixture("vald_resultdefinitions.json")["resultDefinitions"]
    with pytest.raises(ValueError, match="more than one"):
        find_definition(defs, ("Imp-Mom",), "jump height")


def test_inches_are_converted_and_unknown_units_stop():
    inches = {"resultName": "x", "resultUnit": "Inch", "resultUnitScaleFactor": 39.3701}
    assert unit_factor(inches, TO_CM, "cm") == pytest.approx(39.3701 * 2.54)
    newtons = {"resultName": "Peak Force", "resultUnit": "Newton", "resultUnitScaleFactor": 1}
    with pytest.raises(ValueError, match="no wrong units"):
        unit_factor(newtons, TO_CM, "cm")


def test_local_time_applies_offset_minutes():
    assert local_time("2026-09-21T03:30:00.0000000Z", -300) == datetime(2026, 9, 20, 22, 30)
    assert local_time("2022-06-01T05:53:32.417Z", 600) == datetime(2022, 6, 1, 15, 53, 32, 417000)


def test_missing_settings_are_named():
    s, problems = ValdSettings.from_env({"VALD_CLIENT_ID": "x", "VALD_REGION": "mars"})
    assert s is None
    assert problems[:2] == ["VALD_CLIENT_SECRET", "VALD_TENANT_ID"]
    assert "VALD_REGION" in problems[2]

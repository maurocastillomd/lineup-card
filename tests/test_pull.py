import json
from datetime import date

import pytest
from fakes import FakeTransport, fixture, ok, status

import pull
from lineup_card.adapters.catapult import read_catapult
from lineup_card.adapters.vald import read_vald
from lineup_card.pipeline import run_day

ENV = {"VALD_CLIENT_ID": "id-1", "VALD_CLIENT_SECRET": "secret-1",
       "VALD_TENANT_ID": "99999999-9999-9999-9999-999999999999", "VALD_REGION": "use",
       "CATAPULT_TOKEN": "fake-cat-token", "CATAPULT_HOST": "us",
       "CATAPULT_THROW_SLUG": "fake_throw_count"}
STATS = {"act-game-0920": "catapult_stats_game_0920.json",
         "act-lift-0920": "catapult_stats_lift_0920.json",
         "act-game-0919": "catapult_stats_game_0919.json"}
TESTS = "aaaaaaaa-0000-0000-0000-00000000000"


def transport():
    t = FakeTransport()
    t.on("POST", "/oauth/token", ok(fixture("vald_token.json")))
    t.on("GET", "/profiles", ok(fixture("vald_profiles.json")))
    t.on("GET", "/resultdefinitions", ok(fixture("vald_resultdefinitions.json")))
    t.on("GET", "/tests", ok(fixture("vald_tests_page1.json")), modifiedFromUtc="2026-09-19T00:00:00.000Z")
    t.on("GET", "/tests", ok(fixture("vald_tests_page2.json")), modifiedFromUtc="2026-09-20T12:50:00.000Z")
    t.on("GET", "/tests", status(204), modifiedFromUtc="2026-09-21T15:00:00.000Z")
    t.on("GET", f"/tests/{TESTS}1/trials", ok(fixture("vald_trials_test1.json")))
    t.on("GET", f"/tests/{TESTS}3/trials", ok(fixture("vald_trials_test3.json")))
    t.on("GET", "/api/v6/activities", ok(fixture("catapult_activities.json")))
    t.on("POST", "/api/v6/stats",
         lambda body: ok(fixture(STATS[json.loads(body)["filters"][0]["values"][0]])))
    return t


def run(tmp_path, argv, env=ENV, t=None):
    lines = []
    code = pull.main(argv + ["--data", str(tmp_path)], env=env, transport=t or transport(),
                     today=date(2026, 9, 20), out=lines.append)
    return code, lines


def test_missing_env_exits_2_and_writes_nothing(tmp_path):
    t = FakeTransport()
    code, lines = run(tmp_path, ["--date", "2026-09-20"], env={"VALD_REGION": "use"}, t=t)
    assert code == 2
    assert "VALD_CLIENT_ID" in lines[0] and "CATAPULT_TOKEN" in lines[0] and "CATAPULT_HOST" in lines[0]
    assert t.calls == [] and list(tmp_path.iterdir()) == []


def test_only_selected_source_needs_settings(tmp_path):
    env = {k: v for k, v in ENV.items() if k.startswith("CATAPULT")}
    code, lines = run(tmp_path, ["--source", "catapult"], env=env)
    assert code == 0
    assert (tmp_path / "inbox" / "2026-09-20" / "catapult_openfield.csv").exists()
    assert not (tmp_path / "inbox" / "2026-09-20" / "vald_forcedecks_cmj.csv").exists()


def test_vendor_error_exits_3_and_writes_nothing(tmp_path):
    t = transport()
    t.routes.insert(0, [lambda m, u: u.endswith("/api/v6/activities") or "/api/v6/activities?" in u,
                        [status(500, "server down")]])
    code, lines = run(tmp_path, ["--date", "2026-09-20"], t=t)
    assert code == 3
    assert "HTTP 500" in lines[0] and "GET /api/v6/activities" in lines[0]
    assert list(tmp_path.iterdir()) == []


def test_refuses_the_fictional_demo_folder():
    code = pull.main(["--data", "data/fictional"], env=ENV, transport=FakeTransport(),
                     today=date(2026, 9, 20), out=lambda s: None)
    assert code == 2


def test_end_to_end_pull_then_pipeline(tmp_path):
    code, lines = run(tmp_path, ["--date", "2026-09-20"])
    assert code == 0, lines
    assert lines[0] == "VALD 2026-09-20: 5 CMJ trials, 2 players; files: 2026-09-20"
    assert lines[1] == "Catapult 2026-09-20: 5 periods, 2 players; files: 2026-09-20"
    assert lines[2] == "  note: CATAPULT_PITCH_SLUG not set: pitch_count left blank"
    folder = tmp_path / "inbox" / "2026-09-20"
    trials = read_vald(folder / "vald_forcedecks_cmj.csv")
    periods = read_catapult(folder / "catapult_openfield.csv")
    assert len(trials) == 5 and len(periods) == 5
    assert all(p.day == date(2026, 9, 20) for p in periods)
    assert not list(folder.glob(".*.tmp"))

    (tmp_path / "crosswalk.csv").write_text(
        "lc_id,name,pos,vald_external_id,catapult_name\n"
        "LC01,J. Ortega,RP,V010,Jorge Ortega\n")
    day = run_day(tmp_path, date(2026, 9, 20))
    ids = {p["id"] for p in day["players"]}
    assert "LC01" in ids
    held = {(h["source"], h["raw"]) for h in day["held_out"]}
    assert ("catapult", "Kevin Ruiz") in held                 # not in crosswalk: held out
    assert any(src == "vald" for src, _ in held)


def test_range_and_word_dates(tmp_path):
    t = transport()
    t.on("GET", "/tests", ok(fixture("vald_tests_page1.json")), modifiedFromUtc="2026-09-18T00:00:00.000Z")
    code, lines = run(tmp_path, ["--date", "yesterday", "--to", "today", "--source", "vald"], t=t)
    assert code == 0
    assert lines[0].startswith("VALD 2026-09-19 to 2026-09-20: 5 CMJ trials")


def test_build_site_on_live_data_stays_out_of_web(tmp_path):
    import build_site
    run(tmp_path, ["--date", "2026-09-20"])
    (tmp_path / "crosswalk.csv").write_text(
        "lc_id,name,pos,vald_external_id,catapult_name\nLC01,J. Ortega,RP,V010,Jorge Ortega\n")
    build_site.main(["--data", str(tmp_path)])
    site = tmp_path / "site"
    assert json.loads((site / "data" / "index.json").read_text())["latest"] == "2026-09-20"
    assert (site / "card.html").exists() and not (site / "examples").exists()

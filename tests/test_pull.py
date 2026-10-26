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


def run(tmp_path, argv, env=ENV, t=None, clock=None):
    # tmp_path is outside data/live, so every run here passes --allow-any-dir.
    lines = []
    code = pull.main(argv + ["--data", str(tmp_path), "--allow-any-dir"], env=env,
                     transport=t or transport(), today=date(2026, 9, 20), out=lines.append,
                     sleep=lambda s: None, **({"clock": clock} if clock else {}))
    if code != 2:       # the folder warning comes first; checked here, then left out
        assert "not git-ignored" in lines.pop(0)
    return code, lines


def fail(t, path, reply):
    """Put a route first so every call to `path` gets `reply`."""
    t.routes.insert(0, [lambda m, u: path in u, [reply]])
    return t


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


def test_catapult_failure_keeps_vald_and_exits_3(tmp_path):
    t = fail(transport(), "/api/v6/activities", status(500, "server down"))
    code, lines = run(tmp_path, ["--date", "2026-09-20"], t=t)
    assert code == 3
    text = "\n".join(lines)
    assert "HTTP 500" in text and "GET /api/v6/activities" in text and "server down" not in text
    assert "Failed: Catapult. Succeeded: VALD." in text
    folder = tmp_path / "inbox" / "2026-09-20"
    assert len(read_vald(folder / "vald_forcedecks_cmj.csv")) == 5
    assert not (folder / "catapult_openfield.csv").exists()
    status_file = json.loads((folder / "_status.json").read_text())
    assert status_file["vald"] == "ok" and status_file["catapult"] == "failed"
    assert status_file["pulled_at"].startswith("2026-")


def test_vald_failure_keeps_catapult_and_exits_3(tmp_path):
    t = fail(transport(), "/oauth/token", status(503))
    code, lines = run(tmp_path, ["--date", "2026-09-20"], t=t)
    assert code == 3
    text = "\n".join(lines)
    assert "VALD" in text and "HTTP 503" in text and "Failed: VALD. Succeeded: Catapult." in text
    folder = tmp_path / "inbox" / "2026-09-20"
    assert len(read_catapult(folder / "catapult_openfield.csv")) == 5
    assert not (folder / "vald_forcedecks_cmj.csv").exists()
    assert json.loads((folder / "_status.json").read_text())["vald"] == "failed"


def test_status_file_keeps_the_other_source_on_a_single_source_pull(tmp_path):
    folder = tmp_path / "inbox" / "2026-09-20"
    folder.mkdir(parents=True)
    (folder / "_status.json").write_text('{"vald": "failed", "catapult": "ok", "pulled_at": "x"}')
    env = {k: v for k, v in ENV.items() if k.startswith("VALD")}
    code, _ = run(tmp_path, ["--date", "2026-09-20", "--source", "vald"], env=env)
    assert code == 0
    got = json.loads((folder / "_status.json").read_text())
    assert got["vald"] == "ok" and got["catapult"] == "ok" and got["pulled_at"] != "x"


def test_time_budget_stops_with_exit_3_naming_the_source(tmp_path):
    now = [0.0]
    inner = transport()

    def slow(method, url, headers, body):
        now[0] += 100
        return inner(method, url, headers, body)
    env = {**ENV, "LINEUP_PULL_BUDGET_S": "150"}
    code, lines = run(tmp_path, ["--date", "2026-09-20"], env=env, t=slow, clock=lambda: now[0])
    assert code == 3
    text = "\n".join(lines)
    assert "time budget" in text and "Failed: VALD, Catapult." in text
    assert len(inner.calls) == 2           # token at 0 s, result definitions at 100 s, then stop


def test_bad_budget_setting_exits_2(tmp_path):
    t = FakeTransport()
    code, lines = run(tmp_path, [], env={**ENV, "LINEUP_PULL_BUDGET_S": "soon"}, t=t)
    assert code == 2 and "LINEUP_PULL_BUDGET_S" in lines[0] and t.calls == []


def test_every_day_in_the_range_gets_a_file_even_when_empty(tmp_path):
    stale = tmp_path / "inbox" / "2026-09-19" / "vald_forcedecks_cmj.csv"
    stale.parent.mkdir(parents=True)
    stale.write_text("Name,ExternalId,Date,Time,Test Type,Trial,x,y\nOld,V1,2026-09-19,07:00,CMJ,1,40,0.5\n")
    t = transport()
    t.on("GET", "/tests", ok(fixture("vald_tests_page1.json")), modifiedFromUtc="2026-09-18T00:00:00.000Z")
    code, lines = run(tmp_path, ["--date", "yesterday", "--to", "today", "--source", "vald"], t=t)
    assert code == 0
    assert read_vald(stale) == []                                 # cleared to the header only
    assert stale.read_text().startswith("Name,ExternalId,Date")
    assert "files: 2026-09-19, 2026-09-20" in lines[0]


def test_refuses_the_fictional_demo_folder():
    code = pull.main(["--data", "data/fictional"], env=ENV, transport=FakeTransport(),
                     today=date(2026, 9, 20), out=lambda s: None)
    assert code == 2


@pytest.mark.parametrize("target", ["data/fictional", "DATA/Fictional", "Data/FICTIONAL/inbox",
                                    "data/fictional/../fictional/sub"])
def test_refuses_the_fictional_folder_by_any_spelling(tmp_path, monkeypatch, target):
    fictional = tmp_path / "data" / "fictional"
    fictional.mkdir(parents=True)
    monkeypatch.setattr(pull, "FICTIONAL", fictional)
    lines = []
    code = pull.main(["--data", str(tmp_path / target), "--allow-any-dir"], env=ENV,
                     transport=FakeTransport(), today=date(2026, 9, 20), out=lines.append)
    assert code == 2 and "fictional" in lines[0]
    assert sorted(p.name for p in fictional.iterdir()) == []


def test_refuses_the_fictional_folder_through_a_link(tmp_path, monkeypatch):
    fictional = tmp_path / "data" / "fictional"
    fictional.mkdir(parents=True)
    (tmp_path / "alias").symlink_to(fictional)
    monkeypatch.setattr(pull, "FICTIONAL", fictional)
    code = pull.main(["--data", str(tmp_path / "alias"), "--allow-any-dir"], env=ENV,
                     transport=FakeTransport(), today=date(2026, 9, 20), out=lambda s: None)
    assert code == 2


def test_folder_outside_data_live_needs_allow_any_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(pull, "LIVE", tmp_path / "data" / "live")
    t = FakeTransport()
    lines = []
    code = pull.main(["--data", str(tmp_path / "elsewhere")], env=ENV, transport=t,
                     today=date(2026, 9, 20), out=lines.append)
    assert code == 2 and "--allow-any-dir" in lines[0] and t.calls == []
    assert not (tmp_path / "elsewhere").exists()


def test_allow_any_dir_warns_the_folder_is_not_git_ignored(tmp_path):
    lines = []
    code = pull.main(["--date", "2026-09-20", "--source", "vald", "--data", str(tmp_path),
                      "--allow-any-dir"], env=ENV, transport=transport(), today=date(2026, 9, 20),
                     out=lines.append, sleep=lambda s: None)
    assert code == 0
    assert lines[0] == f"Warning: {tmp_path} is not under data/live, so it is not git-ignored. Never commit it."


def test_data_live_and_folders_under_it_need_no_flag(tmp_path, monkeypatch):
    live = tmp_path / "data" / "live"
    monkeypatch.setattr(pull, "LIVE", live)
    lines = []
    code = pull.main(["--data", str(live / "club-a"), "--date", "2026-09-20", "--source", "vald"],
                     env=ENV, transport=transport(), today=date(2026, 9, 20), out=lines.append,
                     sleep=lambda s: None)
    assert code == 0 and not any("git-ignored" in line for line in lines)


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
    build_site.main(["--data", str(tmp_path), "--allow-any-dir"])
    site = tmp_path / "site"
    assert json.loads((site / "data" / "index.json").read_text())["latest"] == "2026-09-20"
    assert (site / "card.html").exists() and not (site / "examples").exists()


def test_build_site_refuses_a_folder_outside_data_live(tmp_path):
    import build_site
    run(tmp_path, ["--date", "2026-09-20"])
    (tmp_path / "crosswalk.csv").write_text("lc_id,name,pos,vald_external_id,catapult_name\n")
    with pytest.raises(SystemExit, match="--allow-any-dir"):
        build_site.main(["--data", str(tmp_path)])
    assert not (tmp_path / "site").exists()

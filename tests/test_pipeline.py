from datetime import date
from pathlib import Path

import pytest

from lineup_card.pipeline import run_day

DATA = Path(__file__).parent.parent / "data" / "fictional"


@pytest.fixture(scope="module")
def last_day():
    return run_day(DATA, date(2026, 9, 20))


def by_id(day):
    return {p["id"]: p for p in day["players"]}


def test_declining_reliever_is_check_in(last_day):
    assert by_id(last_day)["LC01"]["status"] == "check_in"


def test_steady_player_small_drop_is_no_change_by_noise_gate(last_day):
    brandt = by_id(last_day)["LC03"]
    assert brandt["rsi"]["z"] <= -1.2          # the z gate alone would flag him
    assert brandt["status"] == "no_change"
    assert brandt["rsi"]["beyond_noise"] is False


def test_callup_is_not_enough_data(last_day):
    assert by_id(last_day)["LC02"]["status"] == "not_enough_data"


def test_misspelled_catapult_name_held_out(last_day):
    assert {"source": "catapult", "raw": "Mike Daley", "reason": "not in crosswalk"} in last_day["held_out"]


def test_travel_day_team_shift():
    day = run_day(DATA, date(2026, 9, 15))
    assert day["team_shift"]["beyond_noise"] is True
    assert day["team_shift"]["median_pct"] < -4
    assert "Road trip" in day["schedule"]["note"]


def test_no_day_for_monday_off():
    with pytest.raises(FileNotFoundError):
        run_day(DATA, date(2026, 9, 14))


def test_travel_day_marks_who_dropped_more_than_the_team():
    day = run_day(DATA, date(2026, 9, 15))
    marks = [p["beyond_team"] for p in day["players"]]
    assert any(m is True for m in marks) and any(m is False for m in marks)
    more = [p for p in day["players"] if p["beyond_team"]]
    assert len(more) < sum(p["status"] == "check_in" for p in day["players"])


def test_beyond_team_is_none_without_a_team_shift(last_day):
    assert all(p["beyond_team"] is None for p in last_day["players"])


def test_wellness_only_flags_are_not_marked_down_with_the_team():
    day = run_day(DATA, date(2026, 9, 15))
    for p in day["players"]:
        if p["beyond_team"] is False:
            assert p["rsi"]["z"] is not None and p["rsi"]["z"] <= -1.2


# ---- club.json and the per-source pull status ----

import json
import shutil


@pytest.fixture
def copy_of_demo(tmp_path):
    data = tmp_path / "club"
    shutil.copytree(DATA, data, ignore=shutil.ignore_patterns("club.json"))
    return data


def test_demo_club_file_says_fictional_and_synthetic(last_day):
    assert json.loads((DATA / "club.json").read_text()) == {"name": "Fictional Triple-A Club",
                                                           "synthetic": True}
    assert last_day["club"] == "Fictional Triple-A Club" and last_day["synthetic"] is True
    assert "sources" not in last_day


def test_club_defaults_when_there_is_no_club_file(copy_of_demo):
    day = run_day(copy_of_demo, date(2026, 9, 20))
    assert day["club"] == "Fictional Triple-A Club" and day["synthetic"] is True


def test_club_file_sets_name_and_synthetic(copy_of_demo):
    (copy_of_demo / "club.json").write_text('{"name": "Springfield Club", "synthetic": false}')
    day = run_day(copy_of_demo, date(2026, 9, 20))
    assert day["club"] == "Springfield Club" and day["synthetic"] is False


@pytest.mark.parametrize("text", ['{"name": "", "synthetic": false}', '{"name": "X", "synthetic": "no"}',
                                  '["X"]', "not json"])
def test_bad_club_file_stops_with_a_plain_message(copy_of_demo, text):
    (copy_of_demo / "club.json").write_text(text)
    with pytest.raises(ValueError, match="club.json"):
        run_day(copy_of_demo, date(2026, 9, 20))


def test_day_carries_the_pull_status_when_present(copy_of_demo):
    (copy_of_demo / "inbox" / "2026-09-20" / "_status.json").write_text(
        '{"vald": "ok", "catapult": "failed", "pulled_at": "2026-09-20T12:00:00+00:00"}')
    day = run_day(copy_of_demo, date(2026, 9, 20))
    assert day["sources"] == {"vald": "ok", "catapult": "failed",
                              "pulled_at": "2026-09-20T12:00:00+00:00"}
    assert "sources" not in run_day(copy_of_demo, date(2026, 9, 19))

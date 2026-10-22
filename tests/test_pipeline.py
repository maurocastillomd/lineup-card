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

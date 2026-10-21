from datetime import date, timedelta

from lineup_card.clean import CleanLog
from lineup_card.crosswalk import Crosswalk, Player
from lineup_card.day import STATUS_WORDS, build_day, magnitude
from lineup_card.models import Reading, Status

D0 = date(2026, 8, 20)
TODAY = D0 + timedelta(days=20)
PLAYERS = {"LC01": Player(lc_id="LC01", name="J. Ortega", pos="RP"),
           "LC02": Player(lc_id="LC02", name="K. Ruiz", pos="SP")}
CW = Crosswalk(PLAYERS, {}, {})


def rows():
    out = []
    for i in range(21):
        day = D0 + timedelta(days=i)
        rsi = 0.45 if i == 20 else 0.55 + (0.02 if i % 2 else 0.0)
        for metric, value in (("rsi_mod", rsi), ("wellness_score", 20 + i % 2),
                              ("throw_count", 20)):
            out.append(Reading(athlete_id="LC01", name="J. Ortega", pos="RP", day=day,
                               metric=metric, value=value))
    out.append(Reading(athlete_id="LC02", name="K. Ruiz", pos="SP", day=TODAY,
                       metric="rsi_mod", value=0.5))
    return out


def test_status_words():
    assert STATUS_WORDS[Status.REVIEW] == ("check_in", "Check in")
    assert STATUS_WORDS[Status.INSUFFICIENT] == ("not_enough_data", "Not enough data")


def test_magnitude():
    assert magnitude(-2.4) == "▼ large"
    assert magnitude(-1.5) == "▼ moderate"
    assert magnitude(-0.3) == "– within noise"
    assert magnitude(None) == ""


def test_build_day_shape_and_statuses():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "Fictional Visitors",
                                                    "home_away": "home", "note": ""})
    assert day["synthetic"] is True and day["date"] == TODAY.isoformat()
    by_id = {p["id"]: p for p in day["players"]}
    assert by_id["LC01"]["status"] == "check_in" and by_id["LC01"]["word"] == "Check in"
    assert by_id["LC02"]["status"] == "not_enough_data"
    assert by_id["LC01"]["load"]["throws_7d"] == 140
    assert len(by_id["LC01"]["trend"]) == 14
    assert by_id["LC01"]["rsi"]["beyond_noise"] in (True, None)


def test_players_sorted_worst_first():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "", "home_away": "", "note": ""})
    assert day["players"][0]["id"] == "LC01"

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


def test_driver_magnitude_names_the_flagging_measure():
    from lineup_card.day import driver_magnitude
    from lineup_card.models import DomainAssessment, Domain
    rsi = DomainAssessment(domain=Domain.NEUROMUSCULAR, status=Status.CLEARED, fresh=True,
                           today=0.5, base=None, pct=None, decline_z=0.1)
    well = DomainAssessment(domain=Domain.PERCEPTUAL, status=Status.REVIEW, fresh=True,
                            today=15, base=None, pct=None, decline_z=-4.1)
    assert driver_magnitude([rsi, well]) == "▼ large (wellness)"
    rsi2 = rsi.model_copy(update={"status": Status.MONITOR, "decline_z": -1.5})
    assert driver_magnitude([rsi2, well.model_copy(update={"status": Status.CLEARED})]) == "▼ moderate"
    gated = rsi.model_copy(update={"decline_z": -2.6})          # big z, cleared by noise gate
    assert driver_magnitude([gated, well.model_copy(update={"status": Status.CLEARED})]) == "– within noise"


def test_day_carries_noise_gate_threshold():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "", "home_away": "", "note": ""})
    te = day["te"]["rsi_mod"]
    assert day["noise_gate"]["rsi_mod"] == round(1.5 * te, 4)


SCHED = {"opponent": "", "home_away": "", "note": ""}


def test_stale_jump_carries_its_date_and_age():
    old = [r for r in rows() if not (r.athlete_id == "LC01" and r.metric == "rsi_mod"
                                     and r.day > TODAY - timedelta(days=2))]
    day = build_day(old, TODAY, CW, CleanLog(), SCHED)
    by_id = {p["id"]: p for p in day["players"]}
    rsi = by_id["LC01"]["rsi"]
    assert rsi["observed_on"] == (TODAY - timedelta(days=2)).isoformat()
    assert rsi["days_old"] == 2
    assert by_id["LC01"]["wellness"]["days_old"] == 0
    assert by_id["LC01"]["wellness"]["observed_on"] == TODAY.isoformat()


def test_domain_with_no_reading_has_null_date_and_age():
    day = build_day(rows(), TODAY, CW, CleanLog(), SCHED)
    well = {p["id"]: p for p in day["players"]}["LC02"]["wellness"]
    assert well["observed_on"] is None and well["days_old"] is None
    # baseline-building jump (no base) still reports its date
    rsi = {p["id"]: p for p in day["players"]}["LC02"]["rsi"]
    assert rsi["observed_on"] == TODAY.isoformat() and rsi["days_old"] == 0


def test_load_counts_through_yesterday_not_a_game_today():
    data = [r for r in rows() if not (r.athlete_id == "LC01" and r.metric == "throw_count"
                                      and r.day == TODAY)]
    data.append(Reading(athlete_id="LC01", name="J. Ortega", pos="RP", day=TODAY,
                        metric="throw_count", value=80))
    day = build_day(data, TODAY, CW, CleanLog(), SCHED)
    assert {p["id"]: p for p in day["players"]}["LC01"]["load"]["throws_7d"] == 140


def test_trend_decline_below_flag_threshold_is_labelled_steady_decline():
    from lineup_card.day import driver_magnitude
    from lineup_card.models import Domain, DomainAssessment
    rsi = DomainAssessment(domain=Domain.NEUROMUSCULAR, status=Status.MONITOR, fresh=True,
                           today=0.5, base=None, pct=None, decline_z=-0.8)
    assert driver_magnitude([rsi]) == "▼ steady decline"
    well = DomainAssessment(domain=Domain.PERCEPTUAL, status=Status.MONITOR, fresh=True,
                            today=18, base=None, pct=None, decline_z=-0.9)
    cleared = rsi.model_copy(update={"status": Status.CLEARED, "decline_z": 0.1})
    assert driver_magnitude([cleared, well]) == "▼ steady decline (wellness)"
    assert driver_magnitude([rsi.model_copy(update={"decline_z": -1.2})]) == "▼ moderate"


def test_day_has_signal_and_noise_numbers():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "", "home_away": "", "note": ""})
    ortega = {p["id"]: p for p in day["players"]}["LC01"]["rsi"]
    te = day["te"]["rsi_mod"]
    assert ortega["change"] == round(ortega["today"] - ortega["mean"], 4)
    assert ortega["change_te"] == round(ortega["change"] / te, 1)
    assert ortega["beyond_mdc"] is (ortega["change"] < -round(1.96 * 2 ** 0.5 * te, 4))
    assert abs(ortega["swc_personal"] - 0.2 * ortega["sd"]) <= 0.2 * 0.0005 + 1e-9   # sd is shown rounded to 3 dp
    assert "rsi_mod" in day["signal"]          # one player only: sensitivity needs 2+ baselines

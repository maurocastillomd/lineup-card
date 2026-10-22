from datetime import date

from lineup_card.adapters.catapult import CatapultPeriod
from lineup_card.adapters.vald import CmjTrial
from lineup_card.adapters.wellness import WellnessRow
from lineup_card.clean import CleanLog, clean_catapult, clean_cmj, clean_wellness
from lineup_card.crosswalk import Crosswalk, Player

D = date(2026, 9, 1)
CW = Crosswalk({"LC01": Player(lc_id="LC01", name="J. Doe", pos="RP")},
               {"V001": "LC01"}, {"john doe": "LC01"})


def trial(n, rsi, jump=40.0, ext="V001"):
    return CmjTrial(name="J. Doe", external_id=ext, day=D, trial=n, jump_height_cm=jump, rsi_mod=rsi)


def values(readings, metric):
    return [round(r.value, 4) for r in readings if r.metric == metric]


def test_mean_of_valid_trials():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.50), trial(2, 0.52), trial(3, 0.54)], CW, log)
    assert values(out, "rsi_mod") == [0.52]
    assert values(out, "jump_height_cm") == [40.0]


def test_outlier_trial_dropped_and_logged():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.52), trial(2, 0.53), trial(3, 0.40)], CW, log)
    assert values(out, "rsi_mod") == [0.525]
    assert any(e.rule == "trial_outlier" and e.lc_id == "LC01" for e in log.entries)


def test_fewer_than_two_valid_trials_gives_no_value():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.52)], CW, log)
    assert values(out, "rsi_mod") == []
    assert any(e.rule == "too_few_trials" for e in log.entries)


def test_unmatched_vald_id_held_out():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.5, ext="V999"), trial(2, 0.5, ext="V999")], CW, log)
    assert out == []
    assert log.held_out == [{"source": "vald", "raw": "V999", "reason": "not in crosswalk"}]


def period(n, name="Practice", load=50.0, throws=10, pitches=None, who="John Doe"):
    return CatapultPeriod(player_name=who, period_name=name, period_number=n, day=D,
                          player_load=load, throw_count=throws, pitch_count=pitches)


def test_periods_summed_and_session_total_ignored():
    log = CleanLog()
    out = clean_catapult([period(1), period(2, load=30.0, throws=5),
                          period(0, name="Session Total", load=80.0, throws=15)], CW, log)
    assert values(out, "player_load") == [80.0]
    assert values(out, "throw_count") == [15]
    assert values(out, "pitch_count") == []


def test_unmatched_catapult_name_held_out_once_per_day():
    log = CleanLog()
    clean_catapult([period(1, who="Jon Doe"), period(2, who="Jon Doe")], CW, log)
    assert log.held_out == [{"source": "catapult", "raw": "Jon Doe", "reason": "not in crosswalk"}]


def test_wellness_blank_score_skipped_and_unknown_id_held_out():
    log = CleanLog()
    out = clean_wellness([WellnessRow(athlete_id="LC01", day=D, score=None),
                          WellnessRow(athlete_id="LC77", day=D, score=20)], CW, log)
    assert out == []
    assert any(e.rule == "incomplete_form" for e in log.entries)
    assert log.held_out == [{"source": "wellness", "raw": "LC77", "reason": "not in crosswalk"}]


def test_duplicate_wellness_form_keeps_the_last_and_logs_it():
    log = CleanLog()
    out = clean_wellness([WellnessRow(athlete_id="LC01", day=D, score=12),
                          WellnessRow(athlete_id="LC01", day=D, score=21)], CW, log)
    assert [(r.value, r.athlete_id) for r in out] == [(21, "LC01")]
    dup = [e for e in log.entries if e.rule == "duplicate_form"]
    assert len(dup) == 1 and dup[0].detail == "duplicate wellness form; kept the last one"
    assert dup[0].lc_id == "LC01" and dup[0].day == D


def test_duplicate_catapult_period_counted_once():
    log = CleanLog()
    out = clean_catapult([period(1), period(1), period(2, load=30.0, throws=5)], CW, log)
    assert values(out, "player_load") == [80.0]
    assert values(out, "throw_count") == [15]
    assert [e.rule for e in log.entries] == ["duplicate_period"]

from datetime import date, datetime, timezone

import pytest

from lineup_card.adapters.catapult import CatapultPeriod, read_catapult
from lineup_card.adapters.vald import CmjTrial, read_vald
from lineup_card.inbox import atomic_write, write_catapult, write_vald
from lineup_card.vendors.catapult_api import ApiCatapultPeriod
from lineup_card.vendors.vald_api import ApiCmjTrial

BASE_VALD = set(CmjTrial.model_fields)
BASE_CAT = set(CatapultPeriod.model_fields)


def test_vald_round_trip(tmp_path):
    trials = [
        ApiCmjTrial(name="Jorge Ortega", external_id="V010", day=date(2026, 9, 20), trial=1,
                    jump_height_cm=41.23456, rsi_mod=0.523, time="07:41"),
        ApiCmjTrial(name="Kevin Ruiz", external_id="2222", day=date(2026, 9, 20), trial=2,
                    jump_height_cm=None, rsi_mod=None),
    ]
    path = write_vald(tmp_path / "inbox" / "2026-09-20", trials)
    back = read_vald(path)
    assert [b.model_dump() for b in back] == [t.model_dump(include=BASE_VALD) for t in trials]
    assert path.read_text().splitlines()[0] == (
        "Name,ExternalId,Date,Time,Test Type,Trial,Jump Height (Imp-Mom) [cm],RSI-modified [m/s]")


def test_catapult_round_trip_and_local_day(tmp_path):
    start = datetime(2026, 9, 21, 0, 5, tzinfo=timezone.utc)      # 7:05 p.m. CDT on 9/20
    periods = [
        ApiCatapultPeriod(player_name="Jorge Ortega", period_name="Game", period_number=2,
                          day=date(2026, 9, 20), player_load=112.4, throw_count=None, pitch_count=None,
                          start_utc=start, end_utc=start.replace(hour=3)),
        ApiCatapultPeriod(player_name="Kevin Ruiz", period_name="Warm-up", period_number=1,
                          day=date(2026, 9, 20), player_load=None, throw_count=18, pitch_count=0,
                          start_utc=start.replace(day=20, hour=22), end_utc=None),
    ]
    path = write_catapult(tmp_path / "x", periods)
    back = read_catapult(path)
    assert [b.model_dump() for b in back] == [p.model_dump(include=BASE_CAT) for p in periods]
    lines = path.read_text().splitlines()
    assert lines[1] == "Jorge Ortega,Game,2,2026-09-21T00:05:00Z,2026-09-21T03:05:00Z,10800,112.4,,"


def test_failed_write_leaves_old_file_and_no_temp(tmp_path):
    target = tmp_path / "a.csv"
    target.write_text("old\n")

    with pytest.raises(TypeError):
        atomic_write(target, None)           # write fails part way
    assert target.read_text() == "old\n"
    assert [p.name for p in tmp_path.iterdir()] == ["a.csv"]

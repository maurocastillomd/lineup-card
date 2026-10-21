from datetime import date

from lineup_card.adapters.catapult import read_catapult

HEAD = ("player_name,period_name,period_number,start_time,end_time,duration,"
        "player_load,throw_count,pitch_count\n")


def write(tmp_path, body):
    p = tmp_path / "catapult_openfield.csv"
    p.write_text(HEAD + body, encoding="utf-8")
    return p


def test_reads_periods(tmp_path):
    p = write(tmp_path, "John Doe,Warm-up,1,2026-09-01T21:00:00Z,2026-09-01T21:20:00Z,1200,85.5,12,0\n")
    row = read_catapult(p)[0]
    assert row.player_name == "John Doe" and row.period_number == 1
    assert row.player_load == 85.5 and row.throw_count == 12 and row.pitch_count == 0


def test_session_date_is_local_club_time(tmp_path):
    # 00:30 UTC on Sep 2 is 7:30 p.m. Central on Sep 1
    p = write(tmp_path, "John Doe,Game,2,2026-09-02T00:30:00Z,2026-09-02T03:00:00Z,9000,210,30,95\n")
    assert read_catapult(p)[0].day == date(2026, 9, 1)


def test_blank_counts_are_none(tmp_path):
    p = write(tmp_path, "John Doe,Warm-up,1,2026-09-01T21:00:00Z,2026-09-01T21:20:00Z,1200,85.5,,\n")
    row = read_catapult(p)[0]
    assert row.throw_count is None and row.pitch_count is None

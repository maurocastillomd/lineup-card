from datetime import date

import pytest

from lineup_card.adapters.vald import read_vald

HEAD = "Name,ExternalId,Date,Time,Test Type,Trial,Jump Height (Imp-Mom) [cm],RSI-modified [m/s]\n"


def write(tmp_path, body, head=HEAD):
    p = tmp_path / "vald_forcedecks_cmj.csv"
    p.write_text(head + body, encoding="utf-8")
    return p


def test_reads_cmj_trials(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,41.2,0.531\n"
                        "J. Doe,V001,2026-09-01,07:43,CMJ,2,40.8,0.524\n")
    rows = read_vald(p)
    assert len(rows) == 2
    assert rows[0].external_id == "V001" and rows[0].day == date(2026, 9, 1)
    assert rows[0].trial == 1 and rows[0].jump_height_cm == 41.2 and rows[0].rsi_mod == 0.531


def test_filters_other_test_types(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,SJ,1,38.0,\n"
                        "J. Doe,V001,2026-09-01,07:43,CMJ,1,41.0,0.53\n")
    assert [r.trial for r in read_vald(p)] == [1]


def test_blank_metric_is_none(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,41.0,\n")
    assert read_vald(p)[0].rsi_mod is None


def test_wrong_unit_rejected(tmp_path):
    head = HEAD.replace("[cm]", "[in]")
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,16.2,0.53\n", head)
    with pytest.raises(ValueError, match="expected"):
        read_vald(p)

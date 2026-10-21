import pytest

from lineup_card.adapters.wellness import read_wellness

HEAD = "athlete_id,date,sleep_quality,soreness,fatigue,stress,mood\n"


def test_score_is_sum_of_five_items(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,4,3,4,5,4\n")
    row = read_wellness(p)[0]
    assert row.athlete_id == "LC01" and row.score == 20


def test_out_of_range_item_rejected(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,6,3,4,5,4\n")
    with pytest.raises(ValueError, match="1 to 5"):
        read_wellness(p)


def test_blank_item_means_no_score(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,4,,4,5,4\n")
    assert read_wellness(p)[0].score is None

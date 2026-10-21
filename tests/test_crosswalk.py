import pytest

from lineup_card.crosswalk import Crosswalk

HEAD = "lc_id,name,pos,vald_external_id,catapult_name\n"


def load(tmp_path, body):
    p = tmp_path / "crosswalk.csv"
    p.write_text(HEAD + body)
    return Crosswalk.load(p)


def test_resolves_each_source(tmp_path):
    cw = load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\n")
    assert cw.from_vald("V001") == "LC01"
    assert cw.from_catapult("John Doe") == "LC01"
    assert cw.from_catapult("john doe ") == "LC01"
    assert cw.player("LC01").pos == "RP"


def test_unknown_returns_none(tmp_path):
    cw = load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\n")
    assert cw.from_vald("V999") is None and cw.from_catapult("Jon Doe") is None


def test_duplicate_catapult_name_rejected(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\nLC02,J. Doe,C,V002,John Doe\n")


def test_unknown_position_rejected(tmp_path):
    with pytest.raises(ValueError, match="position"):
        load(tmp_path, "LC01,J. Doe,DH,V001,John Doe\n")

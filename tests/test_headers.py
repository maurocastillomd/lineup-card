import pytest

from lineup_card.adapters.headers import find_column, parse_header


def test_parse_header_with_unit():
    assert parse_header("Jump Height (Imp-Mom) [cm]") == ("Jump Height (Imp-Mom)", "cm")
    assert parse_header("RSI-modified [m/s]") == ("RSI-modified", "m/s")


def test_parse_header_without_unit():
    assert parse_header("Name") == ("Name", None)


def test_find_column_checks_unit():
    headers = ["Name", "Jump Height (Imp-Mom) [cm]"]
    assert find_column(headers, "Jump Height (Imp-Mom)", "cm") == "Jump Height (Imp-Mom) [cm]"


def test_find_column_wrong_unit_raises():
    with pytest.raises(ValueError, match="unit"):
        find_column(["Jump Height (Imp-Mom) [in]"], "Jump Height (Imp-Mom)", "cm")


def test_find_column_unknown_unit_raises():
    with pytest.raises(ValueError, match="Unknown unit"):
        find_column(["RSI-modified [furlongs]"], "RSI-modified", "m/s")


def test_find_column_missing_raises():
    with pytest.raises(ValueError, match="missing"):
        find_column(["Name"], "RSI-modified", "m/s")

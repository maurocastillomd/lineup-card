import csv

from generate_fictional import generate


def test_generator_is_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate(a)
    generate(b)
    fa = (a / "inbox/2026-09-20/vald_forcedecks_cmj.csv").read_text()
    fb = (b / "inbox/2026-09-20/vald_forcedecks_cmj.csv").read_text()
    assert fa == fb


def test_roster_and_scenario_files(tmp_path):
    generate(tmp_path)
    roster = list(csv.DictReader((tmp_path / "crosswalk.csv").open()))
    assert len(roster) == 28
    assert [r["pos"] for r in roster].count("RP") == 8
    assert not (tmp_path / "inbox/2026-09-14").exists()          # Monday off day
    ruiz_early = (tmp_path / "inbox/2026-09-10/vald_forcedecks_cmj.csv").read_text()
    assert "K. Ruiz" not in ruiz_early
    cat = (tmp_path / "inbox/2026-09-19/catapult_openfield.csv").read_text()
    assert "Mike Daley" in cat and "Session Total" in cat
    schedule = list(csv.DictReader((tmp_path / "schedule.csv").open()))
    assert any("Road trip" in s["note"] for s in schedule)

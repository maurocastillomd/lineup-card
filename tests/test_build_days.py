import shutil
from pathlib import Path

from build_site import build
from generate_fictional import generate


def test_days_with_only_empty_files_are_not_built(tmp_path):
    data = tmp_path / "data"
    generate(data)
    empty = data / "inbox" / "2026-09-21"
    empty.mkdir()
    for f in (data / "inbox" / "2026-09-20").glob("*.csv"):
        header = f.read_text().splitlines()[0]
        (empty / f.name).write_text(header + "\n")
    (empty / "_status.json").write_text('{"vald": "failed", "catapult": "failed"}')
    dates = build(data, tmp_path / "out")
    assert "2026-09-21" not in dates
    assert dates[-1] == "2026-09-20"

"""The parity golden files must match what the Python core produces now,
so the JS port is always compared against the current reference."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from write_parity_golden import OUT, golden_days  # noqa: E402


def test_golden_files_are_current():
    days = golden_days()
    on_disk = sorted(p.stem for p in OUT.glob("*.json"))
    assert on_disk == sorted(days), "run scripts/write_parity_golden.py"
    for d, day in days.items():
        assert json.loads((OUT / f"{d}.json").read_text()) == json.loads(json.dumps(day)), d

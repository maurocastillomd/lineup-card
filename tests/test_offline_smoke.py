import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


@pytest.mark.skipif(not Path(CHROME).exists(), reason="Chrome not installed")
def test_sample_builds_a_review_in_the_offline_file(tmp_path):
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    url = (ROOT / "dist" / "lineup-card.html").as_uri() + "#autosample"
    dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp_path}",
                          "--virtual-time-budget=8000", "--dump-dom", url],
                         capture_output=True, text=True, timeout=90).stdout
    assert "Approve" in dom or "approve" in dom, dom[:500]
    assert "J. Ortega" in dom

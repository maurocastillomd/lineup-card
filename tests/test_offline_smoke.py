import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


@pytest.mark.skipif(not Path(CHROME).exists(), reason="Chrome not installed")
def test_sample_opens_the_card_in_the_offline_file(tmp_path):
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    url = (ROOT / "dist" / "lineup-card.html").as_uri() + "#autosample"
    dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp_path}",
                          "--virtual-time-budget=8000", "--dump-dom", url],
                         capture_output=True, text=True, timeout=90).stdout
    assert "2 players to talk to before they train" in dom, dom[:500]
    assert "Sample: this is what staff get each morning." in dom
    assert "J. Ortega" in dom

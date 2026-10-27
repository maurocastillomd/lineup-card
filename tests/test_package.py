import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "dist" / "club-edition"


def test_package_has_everything_and_no_real_data():
    subprocess.run([sys.executable, str(ROOT / "scripts" / "package_club_edition.py")], check=True, cwd=ROOT)
    names = {p.relative_to(PKG).as_posix() for p in PKG.rglob("*") if p.is_file()}
    for need in ("lineup-card.html", "HOW-TO-USE.pdf", "IT-FACT-SHEET.pdf", "COPILOT-CHATGPT-PROMPTS.md",
                 "sample-data/roster.csv", "sample-data/schedule.csv",
                 "licenses/OFL.txt", "licenses/LICENSE-html-to-image.txt", "licenses/LICENSE-anatomy-kit.txt",
                 "licenses/THIRD-PARTY-NOTICES.txt"):
        assert need in names, need
    assert any(n.startswith("sample-data/") and n.endswith("vald_forcedecks_cmj.csv") for n in names)
    assert not any("live" in n for n in names)
    for doc in ("COPILOT-CHATGPT-PROMPTS.md",):
        assert "—" not in (PKG / doc).read_text(), "no em dashes"

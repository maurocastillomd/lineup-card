"""Build the Club Edition share package: dist/club-edition/.

It holds:
  lineup-card.html            the offline app (built fresh by build_offline.py)
  sample-data/                the fictional roster, schedule and daily exports
  HOW-TO-USE.pdf              one Letter page, printed from docs/club-edition/how-to-use.html
  IT-FACT-SHEET.pdf           one Letter page, printed from docs/club-edition/it-fact-sheet.html
  HOW-TO-USE.jpg, IT-FACT-SHEET.jpg   picture previews of the two PDFs (docs/club-edition/*.jpg;
                              regenerate them from the PDFs after changing a handout, then run this again)
  COPILOT-CHATGPT-PROMPTS.md  the optional prompt guide
  licenses/                   third-party notices and full license texts

Only fictional data goes in. Nothing is sent anywhere.

Run: .venv/bin/python scripts/package_club_edition.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from build_offline import LICENSE_FILES, NOTICE  # noqa: E402
DIST = ROOT / "dist"
PKG = DIST / "club-edition"
DOCS = ROOT / "docs" / "club-edition"
FICTIONAL = ROOT / "data" / "fictional"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fail(msg: str) -> None:
    raise SystemExit(f"package_club_edition: {msg}")


def fresh_folder() -> None:
    target = PKG.resolve()
    # Remove only dist/club-edition, never anything else.
    if target.parts[-2:] != ("dist", "club-edition") or target.parent != (ROOT / "dist").resolve():
        fail(f"refusing to remove {target}")
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)


def pdf_pages(path: Path) -> int:
    return len(re.findall(rb"/Type\s*/Page(?![s\w])", path.read_bytes()))


def print_pdf(html: Path, out: Path) -> None:
    if not Path(CHROME).exists():
        fail(f"Google Chrome not found at {CHROME}")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", html.resolve().as_uri()],
                   check=True, capture_output=True, timeout=120)
    if not out.is_file():
        fail(f"Chrome did not write {out.name}")
    pages = pdf_pages(out)
    if pages != 1:
        fail(f"{out.name} has {pages} pages; it must fit on one Letter page")


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    fresh_folder()

    shutil.copy2(DIST / "lineup-card.html", PKG / "lineup-card.html")

    sample = PKG / "sample-data"
    sample.mkdir()
    shutil.copy2(FICTIONAL / "crosswalk.csv", sample / "roster.csv")
    shutil.copy2(FICTIONAL / "schedule.csv", sample / "schedule.csv")
    for day in sorted(p for p in (FICTIONAL / "inbox").iterdir() if p.is_dir()):
        dest = sample / day.name
        dest.mkdir()
        for f in sorted(day.glob("*.csv")):
            shutil.copy2(f, dest / f.name)

    licenses = PKG / "licenses"
    licenses.mkdir()
    for name, src in LICENSE_FILES:
        shutil.copy2(src, licenses / name)
    (licenses / "THIRD-PARTY-NOTICES.txt").write_text(NOTICE, encoding="utf-8")

    shutil.copy2(DOCS / "COPILOT-CHATGPT-PROMPTS.md", PKG / "COPILOT-CHATGPT-PROMPTS.md")
    print_pdf(DOCS / "how-to-use.html", PKG / "HOW-TO-USE.pdf")
    print_pdf(DOCS / "it-fact-sheet.html", PKG / "IT-FACT-SHEET.pdf")
    shutil.copy2(DOCS / "how-to-use.jpg", PKG / "HOW-TO-USE.jpg")
    shutil.copy2(DOCS / "it-fact-sheet.jpg", PKG / "IT-FACT-SHEET.jpg")

    print(f"{PKG.relative_to(ROOT)}/")
    for p in sorted(PKG.iterdir()):
        if p.is_dir():
            files = [f for f in p.rglob("*") if f.is_file()]
            size = sum(f.stat().st_size for f in files)
            print(f"  {p.name}/  {len(files)} files, {size / 1024:,.0f} KB")
        else:
            print(f"  {p.name}  {p.stat().st_size / 1024:,.0f} KB")


if __name__ == "__main__":
    main()

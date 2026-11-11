# Lineup Card: project instructions

Daily one-page staff card built from VALD, Catapult and wellness data. Public repo; GitHub Pages
publishes `main`. The demo uses fictional players only. README.md has the design and the sources.

## Verify every change (before saying done)
1. `.venv/bin/python -m pytest -q`
2. `node --test tests/web/*.test.mjs`  (name the files; a bare directory fails on Node 24)
3. `.venv/bin/python scripts/build_site.py`, then `git status --short`: the rebuilt demo must not
   change unless the change is meant to change it.
4. Card, print or Club Edition changes: `.venv/bin/python scripts/package_club_edition.py`
   (stops if any PDF runs past one page; writes only to the git-ignored `dist/`).
Never push or merge to `main` (GitHub Pages publishes it) and never send the Club Edition package
without Mauro's OK. Real club data lives in `data/live/` (git-ignored): never commit it.

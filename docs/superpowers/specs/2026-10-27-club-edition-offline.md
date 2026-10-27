# Lineup Card, Club Edition (offline): design

Date: 2026-10-27. Requested by Mauro for Ross, Campbell Quirk and Julian Rip
(Cardinals). Choices made by Mauro: one offline HTML file; Copilot/ChatGPT as
an optional prompt pack only.

## Why a separate edition
Mauro reports the club's IT allows only Copilot and ChatGPT as AI. Lineup Card
already contains no AI (checked 2026-10-27: no model calls in src, scripts or
web). What would block it inside a club is different:
1. It needs Python installed.
2. Its pages load Google Fonts and one jsDelivr script.
3. The demo is hosted on public GitHub Pages.

The Club Edition removes all three. Same rules, same card, no install, no
internet, data never leaves the laptop.

## What the staff member does
1. Double-click `lineup-card.html` (Edge or Chrome, Windows or Mac).
2. Drop in the exports: VALD ForceDecks CSV(s), Catapult CSV(s), wellness
   CSV(s) covering at least the last 28 days, plus `roster.csv` (crosswalk).
3. Paste or type today's lineup on the review screen (names or IDs, one per line), as in the hosted demo.
4. Review screen: confirm or dismiss each flag, add a note. Same screen as now,
   including TE, SWC, z, MDC95 on the analyst side.
5. Card: print to one page, save as image, or copy for group text.
6. Optional: paste the approved summary into Copilot or ChatGPT with a prompt
   from the prompt pack to draft the staff note.

## How it is built
- Port the Python core (adapters, clean, crosswalk, engine, frames, day) to
  plain JavaScript modules under `web/js/core/`. Same constants: 28-day
  baseline, min 10, z -2.0 / -1.2, 1.5 x TE gate, freshness 4 days, load
  through yesterday, team shift only on a drop.
- Parity test: for every day of the fictional season, the JS output must equal
  the Python day JSON (golden files written by the Python pipeline). Python
  stays the reference; the existing 173 + 23 tests keep running.
- `scripts/build_offline.py` inlines every script, stylesheet, the anatomy
  board, html-to-image and the three fonts (Fraunces, Hanken Grotesk, IBM Plex
  Mono, all SIL Open Font License) into one `dist/lineup-card.html`.
- A Content-Security-Policy meta tag with `connect-src 'none'` and no outside
  hosts, so the browser itself refuses any network call. A test checks the
  built file contains no http(s) URL that loads anything.
- Saved reviews stay in that browser's storage; "Export review" saves a JSON
  file for the club's own records.

## Not in this edition
- The VALD/Catapult API pull. Vendor keys do not belong in a browser file. A
  club that wants automatic pulls uses the Python edition on an approved
  machine; the offline file reads its output the same way it reads exports.
- Any AI inside the file.

## Share package (`dist/club-edition/`, built, not sent)
- `lineup-card.html`
- `sample-data/`: the fictional roster exports, so anyone can try it in 2 min.
- `HOW-TO-USE.pdf`: one page, pictures first.
- `IT-FACT-SHEET.pdf`: one page. What it is, no install, no network (CSP),
  no AI inside, where data lives, how to delete it, open-source code link.
- `COPILOT-CHATGPT-PROMPTS.md`: 3 to 4 prompts (staff note from the approved
  card, explain a flag in plain words, weekly trend summary). Each starts with
  a line: use only your club-approved Copilot/ChatGPT and follow the club's
  rules on player data.

## Honesty lines
- Says "built by Mauro Castillo as a portfolio example; not a Cardinals
  product" and uses no club logo or marks.
- Says the flag rules are a coaching aid, not a diagnosis or injury predictor.
- Does not claim to meet any club IT policy; the fact sheet states facts IT can
  check for itself.

## Done means
Parity on every fictional day, zero network requests in the browser (checked
with devtools), card prints on one Letter page, works with the file opened
from disk in Chrome and Edge-equivalent Chromium, share package built.
Nothing pushed or sent without Mauro's OK.

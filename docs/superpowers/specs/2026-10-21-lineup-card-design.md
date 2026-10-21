# Lineup Card: design

Date: 2026-10-21. Status: draft for Mauro's review.
Owner: Mauro Castillo. Built on the Readiness engine (~/readiness, commit 09435aa).

## Purpose

A daily staff report for a Triple-A baseball club. It collects force plate,
GPS/IMU and wellness data, cleans and organizes it, flags meaningful change,
pauses for the performance coach to check it, then produces a one-page
"Lineup Card" for staff and the manager.

It is a portfolio piece for Campbell Quirk (Cardinals Performance Analyst).
It must show data judgment, not only charts.

Every page and file says: **Fictional roster. Not a fitness-to-play decision.**
Coaches and medical staff decide participation.

## Out of scope

Live vendor connections, logins, medical notes, injury prediction, more than
one team, HRV, NordBord/ForceFrame tests, language-model wording.

## Architecture

Approach A: a Python pipeline plus a static web app.

```
inbox/ (VALD, Catapult, wellness CSVs)
   -> collect -> clean -> flag (Python)
   -> day JSON
   -> Review screen (web) -> Mauro approves
   -> Lineup Card (web, prints to one page)
```

- Python does everything numeric. The web app never calculates a status; it
  only displays the day JSON and records Mauro's review decisions.
- The public demo is a static site with six weeks of fictional days already
  run through the pipeline. Nothing to install to view it.
- Publishing (GitHub repo, GitHub Pages) happens only with Mauro's OK.

## Folder layout

```
lineup-card/
  src/lineup_card/
    engine.py        copied from Readiness 09435aa, then extended
    models.py        copied, then extended
    adapters/vald.py, catapult.py, wellness.py, api_stub.py
    crosswalk.py     player identity across sources
    clean.py         cleaning rules and the cleaning log
    frames.py        position, team and league context
    day.py           builds one day's JSON
  scripts/
    generate_fictional.py   roster + six weeks of exports
    run_day.py              process inbox for one date
    build_site.py           run every day, write web/data/
  web/
    index.html (review), card.html (Lineup Card), theme.css, app.js
    figures/board/          anatomy availability board (build.mjs)
  data/fictional/  roster.csv, crosswalk.csv, inbox/YYYY-MM-DD/*.csv
  tests/
```

## 1. Collect

- Each date has an inbox folder with up to three files:
  `vald_forcedecks_cmj.csv`, `catapult_openfield.csv`, `wellness.csv`.
- Column names follow public examples. Their headers are labeled "modeled on
  public examples" in the README, because vendor export profiles vary.
  - VALD ForceDecks, one row per trial: `Name`, `ExternalId`, `Date`,
    `Time`, `Test Type`, `Trial`, `Jump Height (Imp-Mom) [cm]`,
    `RSI-modified [m/s]`.
  - Catapult OpenField, one row per period: `player_name`, `period_name`,
    `period_number`, `start_time`, `end_time`, `duration`, `player_load`,
    `throw_count`, `pitch_count`.
  - Wellness, one row per player: `athlete_id`, `date`, `sleep_quality`,
    `soreness`, `fatigue`, `stress`, `mood` (1 to 5, 5 best).
- `api_stub.py` defines the interface a real VALD or Catapult API client
  would fill. It raises a clear error without credentials. The README says
  live connections need a club account.
- "Automatic" in the demo: `run_day.py --date` processes whatever is in that
  date's inbox. A scheduled job (launchd or cron) can call it at 7:00 a.m.;
  the README shows how. The schedule is documented, not installed.

## 2. Clean

Every rule writes an entry to the cleaning log (player, source, rule, what
happened). The log is shown in the review screen.

| Rule | Behaviour |
|---|---|
| Test type | Keep only `Test Type == CMJ` rows before mapping. |
| Units | Parse the unit from the header bracket. Known units only; an unknown unit stops the run with a clear error. |
| Identity | Map `ExternalId` (VALD) and `player_name` (Catapult) to a Lineup Card ID through `crosswalk.csv`. Unmatched or duplicate names are held out and listed for review, never guessed. |
| Trials | Per player per day, drop a trial more than 10% from the median of that day's trials (practitioner convention, stated as such). Use the mean of the remaining trials (Claudino et al. 2017). Fewer than 2 valid trials means no CMJ value that day. |
| Sessions | Sum Catapult periods into one session per player per day. Ignore any row whose `period_name` is a session total, so nothing double counts. |
| Dates | Session date comes from local club time (America/Chicago for the demo). |
| Missing | Missing stays missing. No device row means no load value, never zero. |

## 3. Flag

Only the personal baseline can set a status. Everything else is context.

- Flag metric: RSI-mod (neuromuscular). Jump height is shown, not flagged,
  so the same signal is not counted twice. Wellness composite is the second
  domain, kept from Readiness.
- Baseline: rolling 28 days, at least 10 values (Readiness defaults).
- Two gates, both required for Watch or Check in:
  1. z-score gate (Readiness thresholds): Check in at z <= -2.0, or two
     domains at z <= -1.2. Watch at z <= -1.2 or three straight declines.
  2. Noise gate: the drop from baseline must be larger than the metric's
     typical error (TE). TE is estimated from the squad's own consecutive
     baseline readings: SD of day-to-day differences / sqrt(2) (Hopkins 2000).
     A change inside TE becomes No change, and the log says so. The gate is
     applied per domain: for the two-domain Check in rule, each domain must
     pass its own noise gate.
- Status words: **Check in**, **Watch**, **No change**, **Not enough data**.
  They map to Readiness `review`, `monitor`, `cleared`, `insufficient_data`.
- Each flag carries a plain reason, for example: "RSI-mod 2.1 SD below his
  28-day normal and beyond test noise."

Context frames (never set a status):

- Position: SP, RP, C, IF, OF. Show the group median of today's change,
  in each player's own z units, and the group size n. This median is the
  tick on the band row.
- Team: today's median change across everyone tested. If the team median
  change is itself beyond TE, the card shows one line, for example "Whole
  roster down 6% vs normal. Travel day."
- League: one illustrative reference value per metric, labeled
  "illustrative, not a published MLB norm." No public MiLB VALD norm exists.
- Throwing load: Catapult `throw_count` and `pitch_count`, today and 7-day
  total, shown beside pitchers. Never sets a status.

## 4. Review screen

- Pick the date. Paste or tick today's players (lineup plus probable
  pitchers). This is the only input the tool cannot collect.
- Three panels: players not matched, trials or rows dropped, and every flag
  with its reason and the two gate results.
- For each flag: Confirm, Change status (with a required note), or Remove
  (with a required note).
- **Approve** builds the Lineup Card. Nothing builds before approval.
- Review decisions live in the browser (localStorage) for the demo, and can
  be downloaded as a JSON audit file. No server, no database.

## 5. The Lineup Card (one page)

Theme from maurocastillomd.com: background `#FAFAF9`, ink `#0B0B0C`, accent
`#2039C4`, Fraunces (headings), Hanken Grotesk (body), IBM Plex Mono
(numbers). Status uses words and glyphs first; colour is a backup cue only.

Top to bottom:

1. Header: club, date, opponent, "Fictional roster" label, reviewed by.
2. **Check in today**: ranked list, one plain reason each, plus any review
   note.
3. **Today's players** in band rows grouped by role: grey band = his normal
   range, dot = today, line through dot = test noise, tick = position median,
   status word with direction and size.
4. Rest of the roster behind a "Show full roster" toggle (web only). The
   summary line always names any flagged hidden player, for example:
   "19 others not listed today. 1 needs a talk: J. Ortega (RHP)."
5. Two-week trend lines for flagged players, with team-shift line if any.
6. The anatomy availability board.
7. Footer: data sources, rules in one line, "Not a fitness-to-play decision."

Print: a print stylesheet fits US Letter, one page, black-and-white safe. The
toggle is replaced by the summary line in print.

## 6. Anatomy figures

- Phase 1: **availability board**, a clubhouse board on a wall bracket with
  one peg per player, grouped by role. Each peg's tag shows the status word
  and an engraved glyph. Interactive on the web (hover a peg to see the
  reason); a still SVG in print. Built with the anatomy kit
  (`figureSvg`, `plateHtml`), light theme, Figure size (40 to 80 parts).
- Phase 2 (optional, later): an inspection bench for a how-it-works page.

## Fictional data

- 28-man fictional Triple-A roster: 6 SP, 8 RP, 3 C, 6 IF, 5 OF. Invented
  names; no real players or clubs.
- Six weeks of days, including a road trip with an early-morning arrival
  (team-wide shift), one reliever with a real decline, one new call-up
  without a baseline, one name mismatch in Catapult, and a few bad jump
  trials, so every rule shows up at least once.
- Seeded generator, so every run is identical.

## Testing

- Port the Readiness engine tests that still apply.
- New tests: header unit parsing, unknown unit error, test-type filter,
  trial outlier rule, mean of trials, fewer than 2 trials, period summing
  and no double count, crosswalk hold-out, missing never zero, TE estimate,
  two-gate flag (z passes but inside TE gives No change), context frames
  never change a status, hidden flagged player always named, day JSON shape.
- Browser check of review and card at desktop and phone width; print to PDF
  with headless Chrome and confirm one page.

## Citations to verify before they go in the README

Verified this session: Barth/Hecksteden 2019 (Front Physiol).
To verify: Hopkins 2000; Claudino 2017; Cormack 2008; Gathercole 2015;
Saw 2016; Thornton 2019; Lolli 2019; Impellizzeri 2020; Sainani 2018;
Wong 2011; McMahon 2018; Anicic 2023. Drop: Buchheit 2017 and Ward 2019
unless confirmed.

## Open items

- Fictional club name and opponent names (Mauro to pick, or keep generic).
- Publishing to GitHub and Pages: needs Mauro's OK at that step.

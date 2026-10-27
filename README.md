# Lineup Card

A daily one-page staff report from force plate, GPS and wellness data, with the coach's review before anything is shared.

**Fictional roster and fictional data.** The club, the 28 players, the opponents and every number are invented. No real athlete data is in this repository.

Not a fitness-to-play decision. The card does not predict injury. It shows where a player has changed from his own normal, so the staff knows who to talk to first.

## What it does

1. **Collect.** It reads the day's exports: VALD ForceDecks jumps, Catapult OpenField sessions and a morning wellness form.
2. **Clean.** It matches player names across the three sources, drops bad jump trials and logs every row it drops or holds back.
3. **Flag.** It compares each player with his own recent normal and gives one of four status words.
4. **Review.** The coach checks every flag, then confirms it, changes it or removes it. A change or removal needs a note.
5. **Card.** Only after approval does it build the Lineup Card, which prints to one US Letter page.

## The rules

**His own normal.** Each player is compared with his own last 28 days. He needs at least 10 readings in that window. With fewer, his status is "Not enough data".

**The jump.** The flag metric from the force plate is RSI-mod (jump height divided by time to take off). Each test day, a jump trial more than 10% away from the median of that day's trials is dropped. This 10% rule is a practitioner convention, not a published cutoff. The remaining trials are averaged. Fewer than 2 good trials means no jump value that day. Jump height is shown but never flagged, so the same signal is not counted twice.

**Wellness.** The morning wellness score is the second thing that can flag, also against his own 28 days.

**Gate 1, the z-score.** A z-score says how far today sits from his normal, in units of his usual spread (standard deviations, SD).
- Check in: z at or below -2.0, or both the jump and wellness at or below -1.2.
- Watch: z at or below -1.2, or three straight declines, each bigger than the smallest worthwhile change (0.2 x his SD).

**Gate 2, test noise.** The drop must also be bigger than normal test-to-test noise. Noise is the typical error (TE), estimated from the squad's own back-to-back readings:

TE = SD of day-to-day differences / sqrt(2)

The drop must be larger than 1.5 x TE. Mauro Castillo chose 1.5 x TE on 2026-10-21 as a middle ground for a daily report. For reference, 1 x TE is the loosest common rule and the 95% minimal detectable change (about 2.77 x TE) is the strictest. No validated cutoff exists for countermovement jumps in pro baseball. A big z-score that stays inside 1.5 x TE becomes "No change", and the review screen says so. For the two-measure Check in rule, each measure must pass its own noise gate.

**The four status words.**
- **Check in**: the clearest change from his normal. Talk with him first.
- **Watch**: a smaller change worth a look today.
- **No change**: nothing beyond his normal ups and downs.
- **Not enough data**: no fresh reading, or not enough history yet.

**Signal and noise (review screen).** The review screen shows how sensitive each measure is for this squad, and how big each player's change is in every unit that matters. Worked numbers are RSI-mod on the fictional 2026-09-20.

| Metric | Formula | 2026-09-20 RSI-mod |
|---|---|---|
| TE, typical error | SD of day-to-day differences / sqrt(2) | 0.032 m/s |
| CV | TE / squad mean x 100 | 6.1% |
| SWC, smallest worthwhile change | 0.2 x between-player SD of each player's normal | 0.008 m/s |
| SWC / TE | SWC / TE | 0.26 (marginal) |
| MDC95 | 1.96 x sqrt(2) x TE | 0.087 m/s |
| Your gate | 1.5 x TE | 0.047 m/s |
| z | (today - his mean) / his SD | J. Ortega: -2.18 |
| Change in TE units | (today - his mean) / TE | J. Ortega: -2.9 |

SWC / TE below 1 means one reading cannot settle a change as small as the SWC (Hopkins 2000). That is why a flag also needs the noise gate. The rating bands (1 or more good, 0.5 or more OK, below 0.5 marginal) are a convention.

Two different "SWC" numbers appear in this project. The table's SWC is Hopkins' version: 0.2 x the spread *between* players. The "three straight declines" Watch rule uses 0.2 x *his own* SD, which the review data calls `swc_personal`.

**Context never sets a status.** These are shown next to the status, never used to make it:
- Position: the median change for his position group (SP, RP, C, IF, OF), with the group size.
- Team: the median change across everyone tested today.
- League: one reference value per metric, labelled "illustrative, not a published MLB or MiLB norm". No public Minor League force plate norm exists.
- Workload: Catapult PlayerLoad, plus throws and pitches over the last 7 days for pitchers. Workload runs through yesterday, so a game later today is not counted.

**Team-shift days.** Sometimes the whole roster jumps lower, for example after an early-morning travel arrival. When the team's median jump change is beyond the same 1.5 x TE gate, the card leads with one line, such as "Whole team jumping 10% below normal" (the fictional 2026-09-15 travel day). Below it come the flagged players "Not explained by the team drop": players whose jump fell more than the team's by more than the noise gate, or whose flag did not come from the jump. Last comes a names-only "Down with the team" line. This is grouping only. No status changes on a team-shift day. The team line uses the jump (RSI-mod) only.

**Two kinds of wording.** The review screen is for the analyst and shows z-scores and both gate results. The card is for the coaching staff and uses plain words: today's jump as a percent of his own normal. On the card, the shaded zone is his usual ups and downs, which is the noise gate shown in percent.

**Print.** The roster prints in two columns on one US Letter page. The "Show full roster" toggle is web only. In print, a summary line names any flagged player who is not in today's lineup.

**Example review.** `web/examples/review-2026-09-20.json` is a sample review for 2026-09-20. When no saved review exists in the browser, the card uses it and says "example review".

**Availability board.** The card ends with an isometric board with one peg per player, drawn with the anatomy kit in `web/figures/board/`. The kit is vendored under its MIT license, kept as is.

## Run it

You need Python 3.11 or newer (built on 3.13). Node is only needed for the web tests. Run these from the `lineup-card` folder:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python scripts/generate_fictional.py
.venv/bin/python scripts/build_site.py
python3 -m http.server 8765 --directory web
```

Open http://localhost:8765, mark today's players, decide on each flag, approve. Approving opens the card. You can also go straight to http://localhost:8765/card.html.

The generator is seeded, so every run makes the same files.

## Run it every morning

The morning job pulls yesterday and today from VALD and Catapult, then builds the live site. Yesterday is pulled again because last night's game happened after the morning pull.

```bash
.venv/bin/python scripts/pull.py --date yesterday --to today --data data/live
.venv/bin/python scripts/build_site.py --data data/live
python3 -m http.server 8765 --directory data/live/site
```

`scripts/morning.sh` runs the first two lines. If one source fails (pull exit code 3), it still builds the site from the source that worked, and the card says which data is not from this morning. It then ends with code 3 so the log shows the problem. A missing setting (code 2) stops it before the build. It reads the settings from the macOS Keychain, so no key sits in a file. Store each setting once (macOS asks for the value):

```bash
security add-generic-password -a "$USER" -s lineup-card.VALD_CLIENT_SECRET -w
```

Repeat for each name in `.env.example` that you use. Both schedules below are documented here and are not installed.

Both schedules write the log to `~/Library/Logs/lineup-card-morning.log`, inside your own user folder (only your account can read it). The log holds call names and HTTP status codes, never keys or tokens.

**launchd (macOS).** Save as `~/Library/LaunchAgents/com.lineupcard.morning.plist`, then run `launchctl load ~/Library/LaunchAgents/com.lineupcard.morning.plist`. It runs at 7:00 a.m. launchd does not expand `~`, so replace `YOUR_USER` with your macOS user name.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lineupcard.morning</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-c</string><string>~/lineup-card/scripts/morning.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/YOUR_USER/Library/Logs/lineup-card-morning.log</string>
  <key>StandardErrorPath</key><string>/Users/YOUR_USER/Library/Logs/lineup-card-morning.log</string>
</dict>
</plist>
```

**cron.** The same job as a crontab line:

```
0 7 * * * ~/lineup-card/scripts/morning.sh >> ~/Library/Logs/lineup-card-morning.log 2>&1
```

The Keychain must be unlocked (you are logged in) for either schedule to read the settings. The fictional demo is rebuilt with plain `scripts/build_site.py` and never touches `data/live`.

## Real data

Status: **built to the vendors' published documents, tested against mocked responses, not yet tested against a live account.** Every fact and its source is in `docs/api-sources.md`, with a list of what is still unverified.

| Part | Built | Tested with mocks | Tested live |
|---|---|---|---|
| VALD token, cached until it expires | Yes | Yes | Not yet |
| VALD tests, paged until the end, repeats removed | Yes | Yes | Not yet |
| VALD trials: jump height and RSI-modified found by name, scale factor and units checked | Yes | Yes | Not yet |
| Catapult activities for the club day | Yes | Yes | Not yet |
| Catapult stats by player and period, session totals skipped | Yes | Yes | Not yet |
| Catapult throw and pitch counts | Yes, once the club sets the slugs | Yes | Not yet |
| Inbox CSVs in the same format as a manual export | Yes | Yes (read back by the CSV readers) | Not yet |
| Pull, then build the card from `data/live` | Yes | Yes | Not yet |
| Wellness form | Not from an API. Drop `wellness.csv` into `data/live/inbox/<date>/` | Yes (CSV) | Not yet |

**Getting VALD keys.** Email support@vald.com and ask for External API access. Include your VALD Hub organization ID. VALD sends an API License Agreement to sign. After that they send a client ID and client secret through a link that expires in 7 days. You also need your tenant ID (from the Tenants API or VALD support) and your region: `use` (United States East), `aue` (Australia East) or `euw` (Europe West).

**Getting a Catapult token.** Catapult has to enable API access on the club's OpenField account. Once it is on, an API token can be made in OpenField Cloud. Ask your Catapult contact if you do not see the option. Your host is `us`, `eu` or `apac`. Throw and pitch counts come from Catapult's baseball module, and their parameter names differ by account. Ask Catapult for the two slugs, or list them with the API's `/parameters` call, and set `CATAPULT_THROW_SLUG` and `CATAPULT_PITCH_SLUG`. Until then those columns stay blank.

**Settings.** All settings are environment variables. `.env.example` lists every name with an empty value.

| Variable | Needed | What it is |
|---|---|---|
| `VALD_CLIENT_ID`, `VALD_CLIENT_SECRET` | Yes, for VALD | Keys from VALD support |
| `VALD_TENANT_ID` | Yes, for VALD | Your team's tenant ID |
| `VALD_REGION` | Yes, for VALD | `use`, `aue` or `euw` |
| `VALD_CMJ_TEST_TYPE` | No | Test type code for the jump. Default `CMJ` |
| `VALD_JUMP_RESULT`, `VALD_RSI_RESULT` | No | Exact result name, idString or id, if the defaults are not found |
| `CATAPULT_TOKEN` | Yes, for Catapult | API token from OpenField Cloud |
| `CATAPULT_HOST` | Yes, for Catapult | `us`, `eu` or `apac` |
| `CATAPULT_LOAD_SLUG` | No | Default `total_player_load` |
| `CATAPULT_THROW_SLUG`, `CATAPULT_PITCH_SLUG` | No | Baseball module slugs. Blank columns until set |

**Matching players.** `data/live/crosswalk.csv` has the same columns as the fictional one: `lc_id,name,pos,vald_external_id,catapult_name`. Set each player's External ID in his VALD profile to the `vald_external_id` value, or put his VALD profile ID in that column. `catapult_name` must match the athlete name in OpenField exactly. Anyone not in the crosswalk is held out and listed in the review, never guessed. `schedule.csv` is optional for live data.

**Club name and labels.** Make `data/live/club.json`:

```json
{"name": "Your Club Name", "synthetic": false}
```

With `"synthetic": false` the card and review page drop the "Fictional roster" label (they always say "Not a fitness-to-play decision."), hide the illustrative league line and leave out the availability board, which is drawn for the fictional roster. Without this file the card keeps the fictional demo labels.

**Pull one day by hand.**

```bash
export VALD_CLIENT_ID=... VALD_CLIENT_SECRET=... VALD_TENANT_ID=... VALD_REGION=use
export CATAPULT_TOKEN=... CATAPULT_HOST=us
.venv/bin/python scripts/pull.py --date 2026-09-20
.venv/bin/python scripts/pull.py --date 2026-09-20 --source vald
```

It prints one line per source: rows written, players, and which dates got files. Every day in the range gets a file for each source that worked, with only the header row when there was nothing that day, so pulling a day again clears old rows.

- Exit code 0: every source worked.
- Exit code 2: a setting is missing or wrong, or the folder is refused. The message names it. Nothing is written.
- Exit code 3: at least one source failed (a vendor error, a data problem, or the time budget ran out). The message names the call and the HTTP status, and ends with which source failed and which worked. Each source is written as soon as it works, so a Catapult failure keeps the VALD files, and the other way round. A failed source's old files are left as they were.

Each day folder also gets `_status.json`, for example `{"vald": "ok", "catapult": "failed", "pulled_at": "..."}`. The card reads it and shows "Catapult data not updated this morning." when a source failed.

The whole pull stops after 15 minutes (set `LINEUP_PULL_BUDGET_S` in seconds to change it). Real data goes to `data/live` (git-ignored). Any other folder needs `--allow-any-dir`, and the tool warns that the folder is not git-ignored. `data/fictional` is always refused, however the path is spelled. Files are written to a temporary name and then renamed, so a failed run never leaves half a file.

**Security.**
- Keys live only in environment variables or the macOS Keychain. Never in a file in this folder, never in the repo.
- Logs hold call names and HTTP status codes, never keys, tokens or reply bodies. An error message keeps at most a short error code from the vendor (for example `invalid_client`).
- Redirects from a vendor are refused, so a key is only ever sent to the vendor address in the code. `CATAPULT_HOST` must be `us`, `eu`, `apac` or an https Catapult host name with no path or port.
- `.env` and `data/live/` are in `.gitignore`. Real athlete data must never be committed or put in a public repository.
- A live build goes to `data/live/site/`, never to `web/data/`, which holds the fictional demo.
- Add `data/live/club.json` with `"synthetic": false` (see "Club name and labels") before showing the live site to staff. Without it the site still says "Fictional roster".

**Other notes.**
- The CSV column names are modeled on public examples of VALD ForceDecks and Catapult OpenField exports. Check them against your own club's exports if you load files by hand.
- Catapult times are in UTC. The session date is the club's local date (America/Chicago), so a 7 p.m. game stays on its own day.

## Club Edition (offline)

The Club Edition is one HTML file, `lineup-card.html`, that staff open from disk in a web browser. Checked in Google Chrome. Microsoft Edge uses the same engine but has not been checked yet. They drop in VALD, Catapult and wellness CSV exports plus `roster.csv` (single files, or a whole folder with "Choose a folder"; the last 4 weeks or more of daily exports, since a player needs at least 10 readings in the 28 days before a day to be flagged), review the flags, approve, and print the card with the "Print / PDF" button (Ctrl+P works too). No install, no Python, no internet and no AI inside. A Content-Security-Policy in the file blocks the page from loading or sending data over the network. It does not stop a user clicking a link.

The policy, as built: `default-src 'none'; script-src` followed by the sha256 hashes of its two scripts (the image library and the app); `style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src data:; base-uri 'none'; form-action 'none'`. No `'unsafe-inline'` for scripts: the build hashes each executed script, and the inline data blocks (`type="text/plain"`, `type="image/svg+xml"`) never run. Styles keep `'unsafe-inline'` because the pages set inline style attributes.

**Build the share package.**

```bash
.venv/bin/python scripts/package_club_edition.py
```

It rebuilds `dist/lineup-card.html` (with `scripts/build_offline.py`), then makes `dist/club-edition/` fresh. The script stops if either PDF is longer than one page.

**What is in the package.**
- `lineup-card.html`: the app, about 1.3 MB, with the fictional sample inside.
- `sample-data/`: the fictional `roster.csv`, `schedule.csv` and one folder per day of VALD, Catapult and wellness exports.
- `HOW-TO-USE.pdf`: one page, five steps with pictures (source `docs/club-edition/how-to-use.html`).
- `IT-FACT-SHEET.pdf`: one page of facts IT can check: the policy, where data lives, how to delete it, third-party licenses (source `docs/club-edition/it-fact-sheet.html`).
- `licenses/`: a third-party notice and the full license texts (html-to-image MIT, fonts OFL 1.1, anatomy kit MIT). The same texts are inlined in `lineup-card.html` as a `<script type="text/plain" id="licenses">` block.
- `COPILOT-CHATGPT-PROMPTS.md`: optional prompts for the club's approved Copilot or ChatGPT, used only on the approved card text. The AI never decides who is flagged.

JPEG previews of the two PDFs are in `docs/club-edition/`.

**Documented differences from the Python edition.** None of them is hit by the fictional data, and the parity test checks every fictional day.
1. A Catapult period that starts just after midnight UTC belongs to the club's local day. In Python it belongs to the folder it was pulled into.
2. A Catapult `start_time` with no time zone is an error. Python reads it as the computer's local time.
3. The same row in two overlapping exports is kept once and logged as `duplicate_row` with a count.
4. Files are read in name order, never in the order they were dropped.
5. A row where every cell is blank is skipped. Python fails on it.
6. Errors name the file and the spreadsheet row.
7. `nan`, `inf` and numbers with underscores are refused.
8. More than one schedule file is refused, like more than one roster.

Full wording: `docs/superpowers/plans/2026-10-27-club-edition-offline.md`.

Not tested inside any club's network or with a club's real exports yet.

## Built on Readiness

The status engine is copied from Readiness commit `09435aa` and extended with the noise gate, the context frames and the team-shift grouping.

## Evidence

- Hopkins WG. Measures of reliability in sports medicine and science. *Sports Medicine*. 2000;30(1):1-15. https://doi.org/10.2165/00007256-200030010-00001 (typical error)
- Cormack SJ, Newton RU, McGuigan MR, Doyle TLA. Reliability of measures obtained during single and repeated countermovement jumps. *International Journal of Sports Physiology and Performance*. 2008;3(2):131-144. https://doi.org/10.1123/ijspp.3.2.131
- Gathercole R, Sporer B, Stellingwerff T, Sleivert G. Alternative countermovement-jump analysis to quantify acute neuromuscular fatigue. *International Journal of Sports Physiology and Performance*. 2015;10(1):84-92. https://doi.org/10.1123/ijspp.2013-0413
- Saw AE, Main LC, Gastin PB. Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review. *British Journal of Sports Medicine*. 2016;50(5):281-291. https://doi.org/10.1136/bjsports-2015-094758 (why wellness is a flag)
- Claudino JG, Cronin J, Mezêncio B, et al. The countermovement jump to monitor neuromuscular status: a meta-analysis. *Journal of Science and Medicine in Sport*. 2017;20(4):397-402. https://doi.org/10.1016/j.jsams.2016.08.011 (mean of trials)
- McMahon JJ, Suchomel TJ, Lake JP, Comfort P. Understanding the key phases of the countermovement jump force-time curve. *Strength and Conditioning Journal*. 2018;40(4):96-106. https://doi.org/10.1519/SSC.0000000000000375
- Sainani KL. The problem with "magnitude-based inference". *Medicine & Science in Sports & Exercise*. 2018;50(10):2166-2176. https://doi.org/10.1249/MSS.0000000000001645
- Barth V, Käsbauer H, Ferrauti A, et al. (including Hecksteden A). Individualized monitoring of muscle recovery in elite badminton. *Frontiers in Physiology*. 2019;10:778. https://doi.org/10.3389/fphys.2019.00778 (individual baselines)
- Thornton HR, Delaney JA, Duthie GM, Dascombe BJ. Developing athlete monitoring systems in team sports: data analysis and visualization. *International Journal of Sports Physiology and Performance*. 2019;14(6):698-705. https://doi.org/10.1123/ijspp.2018-0169
- Lolli L, Batterham AM, Hawkins R, et al. Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio calculations. *British Journal of Sports Medicine*. 2019;53(15):921-922. https://doi.org/10.1136/bjsports-2017-098110 (why load is a plain 7-day total, not a ratio)
- Impellizzeri FM, Tenan MS, Kempton T, Novak A, Coutts AJ. Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. *International Journal of Sports Physiology and Performance*. 2020;15(6):907-913. https://doi.org/10.1123/ijspp.2019-0864
- Anicic Z, Janicijevic D, Knezevic OM, et al. Assessment of countermovement jump: what should we report? *Life*. 2023;13(1):190. https://doi.org/10.3390/life13010190

## Tests

```bash
.venv/bin/python -m pytest -q
node --test tests/web/*.test.mjs
```

Name the test files in the Node command. A bare directory fails on Node 24.

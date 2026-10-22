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

**Context never sets a status.** These are shown next to the status, never used to make it:
- Position: the median change for his position group (SP, RP, C, IF, OF), with the group size.
- Team: the median change across everyone tested today.
- League: one reference value per metric, labelled "illustrative, not a published MLB or MiLB norm". No public Minor League force plate norm exists.
- Workload: Catapult PlayerLoad, plus throws and pitches today and over 7 days for pitchers.

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

This crontab line would rebuild the day's data at 7 a.m. It is documented here and is not installed:

```
0 7 * * * cd ~/lineup-card && .venv/bin/python scripts/build_site.py
```

## Real data

- The export column names are modeled on public examples of VALD ForceDecks and Catapult OpenField exports. Check them against your own club's exports before use.
- Catapult times are in UTC. The session date is the club's local date, so a 7 p.m. game stays on its own day.
- A live VALD or Catapult connection needs a club account, API credentials and a data agreement. `src/lineup_card/adapters/api_stub.py` shows where that client would plug in.
- Never put real athlete data in a public repository.

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

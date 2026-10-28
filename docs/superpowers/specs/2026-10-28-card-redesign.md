# Lineup Card redesign: the morning brief

Date: 2026-10-28. Approved by Mauro ("A + small trend", "Yes, build it").
Why: Mauro could not tell what the end result was. The card showed one answer
five ways (count tiles, action cards, dot strip, trend section, peg board), and
the sample opened on an analyst table (TE, SWC, MDC95). The file will be sent
to staff who open it alone, so it must explain itself.

The math does not change. Only presentation, copy and screen order change.
Python parity (36 golden days) must stay green.

## 1. The card

Order, top to bottom:

1. **Top line (small):** `Lineup Card · Sun Sep 20 · Away at Lakeside Fictionals`
   (no opponent part without a schedule), then `Reviewed by <name>.` or the
   existing "Not reviewed yet" banner. Disclaimer chip stays.
2. **Headline (large serif), from `headline(day, players)` in logic.js:**
   - No team drop, n flagged > 0: `2 players to talk to before they train` /
     `1 player to talk to before he trains`.
   - No team drop, none flagged: `No one stands out today`.
   - Team drop (team_shift.beyond_noise): `The whole team is jumping 10% below
     its usual today` and the sub line says how many dropped more than the team
     (`1 player dropped more than the team` / `Nobody dropped more than the team`).
   - Sub line otherwise: `<k> look like their usual selves.` plus, when any,
     ` No history yet: K. Ruiz.` Counts are roster-wide after review decisions.
   - Stale-source note (sourcesNote) shows under the headline when present.
3. **One box per flagged player** (Check in first, then Watch, worst first;
   on a team-drop day only the players not explained by the team drop get
   boxes, and one line names the rest: `Down with the team: A, B.`):
   - Name, position, status glyph + word (existing glyph styles).
   - Reasons as short sentences, from `reasonLines(p)`:
     - `Jumping 17% below his usual` (or `Last jump 2 days ago: 17% below his
       usual`, or `No jump today`).
     - `Felt worse than usual on this morning's form` when wellness z <= -1.2.
     - Pitchers (SP, RP) with load: `215 throws and pitches in the last 7 days`.
     - The review note when the reviewer changed the flag.
   - A flagged player not in today's lineup gets `Not in today's lineup`.
   - Action line: Check in `Talk with him before he trains.`; Watch
     `Keep an eye on him today.`
   - **Two-week jump picture** (inline SVG from `trendSvg(p)`): the 14 trend
     points (z), a shaded band for z -1 to +1 labelled `his usual range`, a
     line through the readings, today's dot in the status colour (hollow when
     the reading is not from today), labels `2 weeks ago` and `today`. Has an
     aria-label in words.
4. **Everyone else:** one button `Show all 28 players` (count is real). It
   opens a compact list grouped by position: name, status word, plain jump
   change; today's lineup players marked `in lineup`. Print shows the list in
   small type in columns. The card still prints on one Letter page.
5. **How to read this (2 sentences):** `Each player is compared with his own
   last 4 weeks, not with the team. A flag means his drop is bigger than his
   normal day-to-day ups and downs. It is a reason to talk, not a decision to
   sit him.` plus the sources line and `Coaches and medical staff decide who
   plays.`
6. Share bar unchanged (Copy for group text, Save as image, Print / PDF,
   Export review).

Removed from the card: count tiles, dot strip and its scale header, the
separate trend section, the availability board (files stay in the repo;
the offline bundle no longer inlines the board).

Words: "his usual" replaces "his normal" on the card. "Jump" stays the coach
word for RSI-mod. Analyst words (z, TE, SWC, MDC95) never appear on the card.

Copy for group text: first lines become the date line, then the headline and
sub line, then each flagged player with reasons, then the disclaimer. The
`NOT REVIEWED YET.` rule stays.

## 2. Opening the offline file

- Start screen: above the inputs, a three-step strip:
  `1 Drop this morning's exports` · `2 Each player is checked against his own
  last 4 weeks` · `3 You get a one-page card: who to talk to and why`.
- The sample button is first and reads `See a sample card`. It opens the
  finished card (latest sample day, with the bundled example review) and a
  banner: `Sample: this is what staff get each morning.` with a link
  `See how it was checked` to the review screen.
- Building from real files still opens the review first (a person must approve).

## 3. Review screen

Order: 1 Today's players, 2 Flags to decide, 3 What was held out or dropped,
then a closed `<details>`: `For analysts: how noisy each test is` holding the
existing test-noise table and the all-players numbers.

## 4. Handouts and package

- how-to-use: lead with "What you get" (a picture of the new card), then the
  steps. Retake screenshots. Still one Letter page, no em dashes.
- IT sheet: update only where it describes the screens.
- Rebuild dist/club-edition with the package script.

## 5. Tests

- logic.test.mjs: `headline` for no flags, 1 flag, 2 flags, team-drop with
  and without players beyond the team; `reasonLines` for stale jump, wellness,
  pitcher load, review note; `trendSvg` returns an SVG with the band and a
  hollow dot when stale; plainSummary new first lines.
- buttons test keeps passing (every button wired).
- Build tests: drop the board-svg marker; bundle still has CSP hashes.
- Hand check (headless Chrome): sample opens the card, one-page print,
  Save image full width, light and dark, 375 px.
- Parity and all existing tests stay green.

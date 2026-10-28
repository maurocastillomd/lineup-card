import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecisions, groupCheckins, parseLineup } from "../../web/js/logic.js";
import { reviewKey } from "../../web/js/store.js";

const players = [
  { id: "LC01", name: "J. Ortega", pos: "RP", status: "check_in", word: "Check in" },
  { id: "LC03", name: "T. Brandt", pos: "OF", status: "no_change", word: "No change" },
  { id: "LC25", name: "M. Serrano", pos: "OF", status: "watch", word: "Watch" },
  { id: "LC02", name: "K. Ruiz", pos: "SP", status: "not_enough_data", word: "Not enough data" },
];

test("parseLineup matches short names, last names and IDs", () => {
  const { ids, unmatched } = parseLineup("T. Brandt\nserrano\nLC02\nNobody Here", players);
  assert.deepEqual(ids, ["LC03", "LC25", "LC02"]);
  assert.deepEqual(unmatched, ["Nobody Here"]);
});

test("applyDecisions changes, removes and confirms", () => {
  const out = applyDecisions(players, {
    LC01: { action: "confirm" },
    LC25: { action: "remove", note: "Tested late after treatment" },
    LC03: { action: "change", status: "watch", note: "Mentioned hamstring" },
  });
  const by = Object.fromEntries(out.map((p) => [p.id, p]));
  assert.equal(by.LC01.status, "check_in");
  assert.equal(by.LC25.status, "no_change");
  assert.equal(by.LC25.word, "No change");
  assert.equal(by.LC25.reviewNote, "Flag removed: Tested late after treatment");
  assert.equal(by.LC03.word, "Watch");
  assert.equal(by.LC03.reviewNote, "Changed to Watch: Mentioned hamstring");
});

const shiftPlayers = [
  { id: "A", name: "A", status: "watch", rsi: { z: -1.5 }, beyond_team: true },
  { id: "B", name: "B", status: "check_in", rsi: { z: -2.0 }, beyond_team: false },
  { id: "C", name: "C", status: "check_in", rsi: { z: -3.6 }, beyond_team: true },
  { id: "D", name: "D", status: "check_in", rsi: { z: null }, beyond_team: null },
  { id: "E", name: "E", status: "no_change", rsi: { z: -2.5 }, beyond_team: true },
  { id: "F", name: "F", status: "watch", rsi: { z: -1.2 }, beyond_team: false },
];

test("groupCheckins without a team shift lists every flagged player", () => {
  for (const shift of [null, undefined, { beyond_noise: false, median_pct: 1 }]) {
    const g = groupCheckins(shiftPlayers, shift);
    assert.equal(g.lead, false);
    assert.deepEqual(g.more.map((p) => p.id), ["C", "B", "D", "A", "F"]);
    assert.deepEqual(g.withTeam, []);
  }
});

test("groupCheckins on a team-shift day splits players down more than the team", () => {
  const g = groupCheckins(shiftPlayers, { beyond_noise: true, median_pct: -10.2, n: 27 });
  assert.equal(g.lead, true);
  assert.deepEqual(g.more.map((p) => p.id), ["C", "D", "A"]);
  assert.deepEqual(g.withTeam.map((p) => p.id), ["B", "F"]);
});

import { plainChange } from "../../web/js/logic.js";

test("plainChange speaks in percent of his usual", () => {
  assert.equal(plainChange({ rsi: { pct: -12.4 }, magnitude: "▼ large" }), "12% below his usual");
  assert.equal(plainChange({ rsi: { pct: 3.2 }, magnitude: "– within noise" }), "3% above his usual");
  assert.equal(plainChange({ rsi: { pct: 0.4 }, magnitude: "– within noise" }), "Right at his usual");
  assert.equal(plainChange({ rsi: { pct: 1.0 }, magnitude: "▼ large (wellness)" }),
    "1% above his usual · wellness low");
  assert.equal(plainChange({ rsi: { pct: null, today: 0.5 }, magnitude: "" }), "Still learning his usual");
  assert.equal(plainChange({ rsi: { pct: null, today: null }, magnitude: "" }), "No jump today");
});

test("plainChange says how old a stale jump is", () => {
  const stale = (days_old, pct) => ({ rsi: { pct, today: 0.4, days_old }, magnitude: "▼ large" });
  assert.equal(plainChange(stale(2, -22.4)), "Jump 2 days ago: 22% below his usual");
  assert.equal(plainChange(stale(1, -9.6)), "Jump 1 day ago: 10% below his usual");
  assert.equal(plainChange(stale(3, 0.2)), "Jump 3 days ago: right at his usual");
  assert.equal(plainChange(stale(0, -22.4)), "22% below his usual");
  assert.equal(plainChange({ rsi: { pct: null, today: null, days_old: null }, magnitude: "" }), "No jump today");
  assert.equal(plainChange({ rsi: { pct: null, today: null, days_old: 9 }, magnitude: "" }), "No jump today");
});

test("parseLineup treats an ambiguous last name as unmatched", () => {
  const twins = [
    { id: "LC10", name: "A. Garcia", pos: "IF" },
    { id: "LC11", name: "B. Garcia", pos: "OF" },
    { id: "LC12", name: "C. Smith", pos: "SP" },
  ];
  const { ids, unmatched } = parseLineup("Garcia\nA. Garcia\nsmith", twins);
  assert.deepEqual(ids, ["LC10", "LC12"]);
  assert.deepEqual(unmatched, ["Garcia"]);
});

test("hasSavedReview is true only when a review key exists", async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const { hasSavedReview, saveReview, emptyReview } = await import("../../web/js/store.js");
  assert.equal(hasSavedReview("2026-09-20"), false);
  saveReview("2026-09-20", { ...emptyReview(), approvedAt: null });
  assert.equal(hasSavedReview("2026-09-20"), true);
  assert.equal(hasSavedReview("2026-09-19"), false);
  globalThis.localStorage = { getItem() { throw new Error("blocked"); } };
  assert.equal(hasSavedReview("2026-09-20"), false);
  delete globalThis.localStorage;
});

import { signalLine } from "../../web/js/logic.js";

test("signalLine shows change, %, TE units, z and both thresholds", () => {
  const d = { change: -0.09, pct: -16.9, change_te: -2.9, z: -2.18, beyond_noise: true, beyond_mdc: true };
  assert.equal(signalLine("RSI-mod", "m/s", d),
    "RSI-mod: -0.090 m/s (-16.9%) · -2.9 TE · z -2.18 · past your gate · past MDC95");
  const w = { change: -1.2, pct: -6.0, change_te: -0.8, z: -1.4, beyond_noise: false, beyond_mdc: false };
  assert.equal(signalLine("Wellness", "pts", w, 1),
    "Wellness: -1.2 pts (-6.0%) · -0.8 TE · z -1.40 · inside your gate · inside MDC95");
  assert.equal(signalLine("RSI-mod", "m/s", { change: undefined, z: null }), "RSI-mod: no baseline yet");
});

import { plainSummary } from "../../web/js/logic.js";

// synthetic: true matches the fictional demo's day JSON.
const sumDay = (team_shift, note = "") => ({
  date: "2026-09-20",
  synthetic: true,
  schedule: { opponent: "Lakeside Fictionals", home_away: "away", note },
  team_shift,
});
const sumPlayers = [
  { id: "LC01", name: "J. Ortega", pos: "RP", status: "check_in", beyond_team: null,
    rsi: { pct: -16.9, z: -2.18, days_old: 0 }, wellness: { z: -2.34 }, load: { throws_7d: 196 } },
  { id: "LC13", name: "C. Duvall", pos: "RP", status: "watch", beyond_team: false,
    rsi: { pct: -11.2, z: -1.4, days_old: 0 }, wellness: { z: -0.3 }, load: { throws_7d: 185 } },
  { id: "LC03", name: "T. Brandt", pos: "OF", status: "no_change", rsi: { pct: -1.4, z: -0.2, days_old: 0 }, wellness: {}, load: {} },
  { id: "LC02", name: "K. Ruiz", pos: "SP", status: "not_enough_data", rsi: { pct: null, today: null }, wellness: {}, load: {} },
];

test("plainSummary on a normal day: date line, headline, sub line, each flagged player, disclaimer", () => {
  const text = plainSummary(sumDay({ median_pct: 1.0, beyond_noise: false, n: 27 }), sumPlayers, ["LC03"]);
  assert.equal(text, [
    "Lineup Card · Sun Sep 20 · Away at Lakeside Fictionals",
    "2 players to talk to before they train",
    "1 looks like his usual self. No history yet: K. Ruiz.",
    "Check in: J. Ortega (RP). Jumping 17% below his usual. Felt much worse than usual on this morning's form. " +
      "196 throws and pitches in the last 7 days. Not in today's lineup.",
    "Watch: C. Duvall (RP). Jumping 11% below his usual. 185 throws and pitches in the last 7 days. Not in today's lineup.",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary on a team-drop day leads with the team and names the rest in one line", () => {
  const text = plainSummary(sumDay({ median_pct: -10.2, beyond_noise: true, n: 27 }, "Road trip: 4 a.m. arrival"),
    sumPlayers, []);
  assert.equal(text, [
    "Lineup Card · Sun Sep 20 · Away at Lakeside Fictionals",
    "The whole team is jumping 10% below its usual today",
    "1 player to talk to anyway. 1 more is down with the team. No history yet: K. Ruiz.",
    "Not explained by the team drop:",
    "Check in: J. Ortega (RP). Jumping 17% below his usual. Felt much worse than usual on this morning's form. " +
      "196 throws and pitches in the last 7 days.",
    "Down with the team: C. Duvall.",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary when nobody is flagged", () => {
  const calm = sumPlayers.map((p) => ({ ...p, status: p.status === "not_enough_data" ? p.status : "no_change" }));
  const text = plainSummary({ ...sumDay(null), date: "2026-09-05" }, calm, []);
  assert.equal(text, [
    "Lineup Card · Sat Sep 5 · Away at Lakeside Fictionals",
    "No one stands out today",
    "3 look like their usual selves. No history yet: K. Ruiz.",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary adds the review note and never shifts the date", () => {
  const p = [{ ...sumPlayers[2], status: "watch", reviewNote: "Changed to Watch: Mentioned hamstring" }];
  const text = plainSummary({ ...sumDay(null), date: "2026-01-01" }, p, []);
  assert.match(text, /^Lineup Card · Thu Jan 1 ·/);
  assert.match(text, /Watch: T\. Brandt \(OF\)\. Jumping 1% below his usual\. Changed to Watch: Mentioned hamstring\./);
});

import { disclaimer, sourcesNote } from "../../web/js/logic.js";

test("disclaimer: fictional line only when the day is synthetic", () => {
  assert.equal(disclaimer({ synthetic: true }), "Fictional roster. Not a fitness-to-play decision.");
  assert.equal(disclaimer({ synthetic: false }), "Not a fitness-to-play decision.");
  assert.equal(disclaimer({}), "Not a fitness-to-play decision.");
});

test("plainSummary on a real-data day leaves out the fictional line", () => {
  const text = plainSummary({ ...sumDay(null), synthetic: false }, sumPlayers, []);
  const lines = text.split("\n");
  assert.equal(lines.at(-1), "Not a fitness-to-play decision.");
  assert.doesNotMatch(text, /Fictional roster/);
});

test("sourcesNote names a source that did not update", () => {
  assert.equal(sourcesNote({ sources: { vald: "ok", catapult: "failed" } }), "Catapult data not updated this morning.");
  assert.equal(sourcesNote({ sources: { vald: "failed", catapult: "ok" } }), "VALD data not updated this morning.");
  assert.equal(sourcesNote({ sources: { vald: "failed", catapult: "failed" } }),
    "VALD and Catapult data not updated this morning.");
  assert.equal(sourcesNote({ sources: { vald: "ok", catapult: "ok" } }), "");
  assert.equal(sourcesNote({ sources: { vald: "ok" } }), "");
  assert.equal(sourcesNote({}), "");
});

test("plainSummary carries the not-updated line after the headline and sub line", () => {
  const day = { ...sumDay(null), sources: { vald: "ok", catapult: "failed" } };
  const lines = plainSummary(day, sumPlayers, []).split("\n");
  assert.equal(lines[3], "Catapult data not updated this morning.");
});

test("review keys: demo key unchanged, club data scoped by club", () => {
  assert.equal(reviewKey("2026-09-20"), "lineupcard:review:2026-09-20");
  assert.equal(reviewKey("2026-09-20", "Memphis"), "lineupcard:review:Memphis:2026-09-20");
});

import { topLine } from "../../web/js/logic.js";

test("topLine names the opponent only when the schedule has one", () => {
  const day = (opponent, home_away) => ({ club: "Fictional Triple-A Club", schedule: { opponent, home_away, note: "" } });
  assert.equal(topLine(day("Riverton", "home"), "2026-09-20"), "Lineup Card · Sun Sep 20 · Home vs Riverton");
  assert.equal(topLine(day("Lakeside Fictionals", "away"), "2026-09-20"), "Lineup Card · Sun Sep 20 · Away at Lakeside Fictionals");
  assert.equal(topLine(day("", ""), "2026-09-20"), "Lineup Card · Sun Sep 20");
  assert.equal(topLine({}, "2026-01-01"), "Lineup Card · Thu Jan 1");
});

test("plainSummary leaves out the opponent when there is no schedule", () => {
  const day = { ...sumDay(null), schedule: { opponent: "", home_away: "", note: "" } };
  assert.equal(plainSummary(day, sumPlayers, []).split("\n")[0], "Lineup Card · Sun Sep 20");
});

test("plainSummary starts with NOT REVIEWED YET. only when the review is not approved", () => {
  const day = sumDay(null);
  const approved = plainSummary(day, sumPlayers, []);
  assert.equal(plainSummary(day, sumPlayers, [], { reviewed: true }), approved);
  const open = plainSummary(day, sumPlayers, [], { reviewed: false });
  assert.equal(open, `NOT REVIEWED YET.\n${approved}`);
});

import { headline, reasonLines, trendSvg } from "../../web/js/logic.js";

const roster = (statuses) => statuses.map((status, i) => ({
  id: `P${i}`, name: `P. Player${i}`, pos: "IF", status, beyond_team: null, rsi: { pct: -1, z: -0.1, days_old: 0 },
}));

test("headline when nobody is flagged", () => {
  const h = headline({ team_shift: { beyond_noise: false, median_pct: 0.4 } }, roster(["no_change", "no_change", "no_change"]));
  assert.deepEqual(h, { title: "No one stands out today", sub: "3 look like their usual selves." });
});

test("headline with one flag uses he, and names players with no history", () => {
  const players = roster(["check_in", "no_change", "no_change", "not_enough_data"]);
  players[3].name = "K. Ruiz";
  const h = headline({ team_shift: null }, players);
  assert.equal(h.title, "1 player to talk to before he trains");
  assert.equal(h.sub, "2 look like their usual selves. No history yet: K. Ruiz.");
});

test("headline with two flags counts Check in and Watch, roster-wide", () => {
  const h = headline({}, roster(["check_in", "watch", ...Array(25).fill("no_change"), "not_enough_data"]));
  assert.equal(h.title, "2 players to talk to before they train");
  assert.equal(h.sub, "25 look like their usual selves. No history yet: P. Player27.");
});

test("headline on a team-drop day counts the boxes and the players down with the team", () => {
  const players = roster(["check_in", "check_in", "watch", "check_in", "no_change", "not_enough_data"]);
  players[0].beyond_team = true;
  players[1].beyond_team = false;
  players[2].beyond_team = false;
  players[3].beyond_team = null;    // flagged for wellness: not explained by the team drop either
  players[5].name = "K. Ruiz";
  const h = headline({ team_shift: { beyond_noise: true, median_pct: -10.2, n: 27 } }, players);
  assert.equal(h.title, "The whole team is jumping 10% below its usual today");
  assert.equal(h.sub, "2 players to talk to anyway. 2 more are down with the team. No history yet: K. Ruiz.");
});

test("headline on a team-drop day: singular forms, and nobody beyond the drop", () => {
  const shift = { team_shift: { beyond_noise: true, median_pct: -8.6, n: 27 } };
  const one = roster(["check_in", "watch"]);
  one[1].beyond_team = false;
  assert.equal(headline(shift, one).sub, "1 player to talk to anyway. 1 more is down with the team.");
  const none = roster(["check_in", "watch"]).map((p) => ({ ...p, beyond_team: false }));
  const h = headline(shift, none);
  assert.equal(h.title, "The whole team is jumping 9% below its usual today");
  assert.equal(h.sub, "Nobody stands out beyond the team drop.");
  const all = roster(["check_in", "check_in"]).map((p) => ({ ...p, beyond_team: true }));
  assert.equal(headline({ team_shift: { beyond_noise: true, median_pct: -12 } }, all).sub, "2 players to talk to anyway.");
});

test("reasonLines: jump-driven flag leads with the jump; wellness wording by size", () => {
  const p = { pos: "RP", magnitude: "▼ large", rsi: { pct: -16.9, today: 0.44, days_old: 0 }, wellness: { z: -1.5 },
    load: { throws_7d: 215 } };
  assert.deepEqual(reasonLines(p), [
    "Jumping 17% below his usual",
    "Felt worse than usual on this morning's form",
    "215 throws and pitches in the last 7 days",
  ]);
  assert.equal(reasonLines({ ...p, wellness: { z: -2.0 } })[1], "Felt much worse than usual on this morning's form");
});

test("reasonLines: wellness-driven flag leads with wellness, then the jump", () => {
  const p = { pos: "RP", magnitude: "▼ large (wellness)", rsi: { pct: -16.9, today: 0.44, days_old: 0 },
    wellness: { z: -2.34 }, load: { throws_7d: 215 } };
  assert.deepEqual(reasonLines(p), [
    "Felt much worse than usual on this morning's form",
    "Jumping 17% below his usual",
    "215 throws and pitches in the last 7 days",
  ]);
});

test("reasonLines: wellness-driven flag with a normal jump says the jump looks normal", () => {
  const p = { pos: "OF", magnitude: "▼ moderate (wellness)", rsi: { pct: 0.4, today: 0.5, days_old: 0 },
    wellness: { z: -1.7 }, load: { throws_7d: 300 } };
  assert.deepEqual(reasonLines(p), ["Felt worse than usual on this morning's form", "Jump looks normal"]);
  // A jump-driven flag never says this; a stale reading keeps its age.
  assert.deepEqual(reasonLines({ ...p, magnitude: "▼ large" }), ["Jumping right at his usual", "Felt worse than usual on this morning's form"]);
  assert.deepEqual(reasonLines({ ...p, rsi: { ...p.rsi, days_old: 2 } }),
    ["Felt worse than usual on this morning's form", "Last jump 2 days ago: right at his usual"]);
});

test("reasonLines: a stale jump says how old it is", () => {
  const p = { pos: "OF", rsi: { pct: -16.6, today: 0.4, days_old: 2 }, wellness: { z: -0.4 }, load: { throws_7d: 300 } };
  assert.deepEqual(reasonLines(p), ["Last jump 2 days ago: 17% below his usual"]);
  assert.deepEqual(reasonLines({ ...p, rsi: { ...p.rsi, days_old: 1, pct: 0.3 } }), ["Last jump 1 day ago: right at his usual"]);
});

test("reasonLines: no jump today, wellness edge, hitters have no load line", () => {
  const p = { pos: "IF", rsi: { pct: null, today: null, days_old: null }, wellness: { z: -1.2 }, load: { throws_7d: 380 } };
  assert.deepEqual(reasonLines(p), ["No jump today", "Felt worse than usual on this morning's form"]);
  assert.deepEqual(reasonLines({ ...p, wellness: { z: -1.19 } }), ["No jump today"]);
  assert.deepEqual(reasonLines({ ...p, pos: "SP", wellness: {}, load: {} }), ["No jump today"]);
});

test("reasonLines: the reviewer's change comes last", () => {
  const p = { pos: "C", rsi: { pct: 4.2, today: 0.5, days_old: 0 }, wellness: { z: 0.1 }, load: {},
    reviewNote: "Changed to Watch: Mentioned hamstring" };
  assert.deepEqual(reasonLines(p), ["Jumping 4% above his usual", "Changed to Watch: Mentioned hamstring"]);
});

const trendOf = (zs) => zs.map((z, i) => ({ date: `2026-09-${String(7 + i).padStart(2, "0")}`, z }));

test("trendSvg draws the usual band, the line, labels and a filled dot for today", () => {
  const p = { name: "J. Ortega", status: "check_in", rsi: { pct: -16.9, days_old: 0 },
    trend: trendOf([null, -0.7, -0.1, -0.6, 2.3, -1.9, -0.4, null, -0.6, -1.6, -0.4, -1.1, -4.0, -2.2]) };
  const svg = trendSvg(p);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /class="tr-band"/);
  assert.match(svg, />his usual range</);
  assert.match(svg, />2 weeks ago</);
  assert.match(svg, />today</);
  assert.match(svg, /class="tr-line"/);
  assert.match(svg, /class="tr-dot tr-check_in"/);
  assert.doesNotMatch(svg, /tr-hollow/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="J\. Ortega, jump over the last two weeks: today 17% below his usual, below his usual range\."/);
});

test("trendSvg shows a hollow dot when the last reading is not from today", () => {
  const p = { name: "A. B", status: "watch", rsi: { pct: -12, days_old: 2 },
    trend: trendOf([0.2, 0.1, -0.3, 0.4, 0.5, -0.2, 0.1, 0.3, -0.1, 0.2, 0.0, -1.8, null, null]) };
  const svg = trendSvg(p);
  assert.match(svg, /class="tr-dot tr-watch tr-hollow"/);
  assert.match(svg, /last jump 2 days ago: 12% below his usual/);
});

test("trendSvg with no readings says so and still has the band", () => {
  const p = { name: "K. Ruiz", status: "check_in", rsi: { pct: null, today: null }, trend: trendOf(Array(14).fill(null)) };
  const svg = trendSvg(p);
  assert.match(svg, /class="tr-band"/);
  assert.doesNotMatch(svg, /tr-dot/);
  assert.match(svg, /aria-label="K\. Ruiz, jump over the last two weeks: no jumps yet\."/);
});

test("trendSvg escapes the name", () => {
  const p = { name: 'A "<b>"', status: "watch", rsi: { pct: -5, days_old: 0 }, trend: trendOf([-1.5]) };
  assert.doesNotMatch(trendSvg(p), /<b>/);
});

import { rosterLabel } from "../../web/js/logic.js";

test("rosterLabel: on a team-drop day a flag explained by the drop shows as Down with team", () => {
  const drop = { beyond_noise: true, median_pct: -10.2, n: 27 };
  const p = (status, beyond_team) => ({ status, word: { check_in: "Check in", watch: "Watch", no_change: "No change" }[status], beyond_team });
  assert.deepEqual(rosterLabel(p("check_in", false), drop), { kind: "with_team", word: "Down with team" });
  assert.deepEqual(rosterLabel(p("watch", false), drop), { kind: "with_team", word: "Down with team" });
  // Not explained by the drop (beyond it, or flagged for another reason): keeps its status.
  assert.deepEqual(rosterLabel(p("check_in", true), drop), { kind: "check_in", word: "Check in" });
  assert.deepEqual(rosterLabel(p("check_in", null), drop), { kind: "check_in", word: "Check in" });
  // Unflagged players never get the label, even with beyond_team false.
  assert.deepEqual(rosterLabel(p("no_change", false), drop), { kind: "no_change", word: "No change" });
});

test("rosterLabel: without a team drop every player keeps his status", () => {
  const p = { status: "check_in", word: "Check in", beyond_team: false };
  for (const shift of [null, undefined, { beyond_noise: false, median_pct: -3 }]) {
    assert.deepEqual(rosterLabel(p, shift), { kind: "check_in", word: "Check in" });
  }
});

test("rosterLabel leaves the player's status and word untouched", () => {
  const p = { status: "check_in", word: "Check in", beyond_team: false };
  rosterLabel(p, { beyond_noise: true, median_pct: -9 });
  assert.equal(p.status, "check_in");
  assert.equal(p.word, "Check in");
});

import { printLayout } from "../../web/js/logic.js";

test("printLayout: up to 4 boxes keep pictures and every reason; more boxes trade both for one page", () => {
  const L = (density, pictures, reasons, roster, rowGap) => ({ density, pictures, reasons, roster, rowGap });
  // Few boxes leave room, so the roster rows open up to fill the page.
  assert.deepEqual(printLayout(0), L("roomy", true, "all", 10, 9));
  assert.deepEqual(printLayout(1), L("roomy", true, "all", 10, 6));
  assert.deepEqual(printLayout(2), L("roomy", true, "all", 10, 3.5));
  assert.deepEqual(printLayout(3), L("roomy", true, "all", 10, 2.5));
  assert.deepEqual(printLayout(4), L("roomy", true, "all", 10, 2.5));
  // 5 or 6 boxes (09-15 has 6): three across, no pictures, the first two reasons.
  assert.deepEqual(printLayout(5), L("normal", false, 2, 10, 1.5));
  assert.deepEqual(printLayout(6), L("normal", false, 2, 10, 1.5));
  // 7 or more (09-06 has 7): a list, one line each (status, name, the reason that drove the flag), no pictures.
  assert.deepEqual(printLayout(7), L("tight", false, 1, 10, 4));
  assert.deepEqual(printLayout(8), L("tight", false, 1, 10, 3));
  assert.deepEqual(printLayout(9), L("tight", false, 1, 10, 1.5));
  assert.deepEqual(printLayout(11), L("tight", false, 1, 10, 1.5));
  // 12 or more: the roster drops to its 9pt floor, never smaller.
  assert.deepEqual(printLayout(12), L("tight", false, 1, 9, 0.5));
  assert.deepEqual(printLayout(28), L("tight", false, 1, 9, 0.5));
  // Roster type is 9 to 10pt at every count: never under 9, and never wider than two tables fit on Letter.
  for (let n = 0; n <= 28; n++) assert.ok(printLayout(n).roster >= 9 && printLayout(n).roster <= 10);
});

import { rosterForm, rosterJump } from "../../web/js/logic.js";

test("rosterJump: the jump column of the printed roster, short", () => {
  assert.equal(rosterJump({ rsi: { pct: -13.4, today: 0.4, days_old: 0 } }), "13% below");
  assert.equal(rosterJump({ rsi: { pct: 2.1, today: 0.5, days_old: 0 } }), "2% above");
  assert.equal(rosterJump({ rsi: { pct: 0.4, today: 0.5, days_old: 0 } }), "at his usual");
  assert.equal(rosterJump({ rsi: { pct: -13.2, today: 0.4, days_old: 2 } }), "13% below, 2 days ago");
  assert.equal(rosterJump({ rsi: { pct: -5, today: 0.4, days_old: 1 } }), "5% below, 1 day ago");
  assert.equal(rosterJump({ rsi: { pct: null, today: null } }), "no jump today");
  assert.equal(rosterJump({ rsi: { pct: null, today: 0.5 } }), "no history yet");
});

test("rosterForm: the morning form column says low only when the form is clearly low", () => {
  assert.equal(rosterForm({ wellness: { z: -1.2 } }), "low");
  assert.equal(rosterForm({ wellness: { z: -2.6 } }), "low");
  assert.equal(rosterForm({ wellness: { z: -1.19 } }), "");
  assert.equal(rosterForm({ wellness: { z: null } }), "");
  assert.equal(rosterForm({}), "");
});

import { byJumpChange } from "../../web/js/logic.js";

test("roster order: biggest jump change first, up or down, then no jump by name", () => {
  const p = (name, pct) => ({ name, rsi: pct === undefined ? { today: null } : { pct } });
  const order = [p("Cole", 3.2), p("Ames", undefined), p("Diaz", -12.4), p("Bell", 8.9), p("Ford", -0.4), p("Eads", undefined)]
    .sort(byJumpChange).map((x) => x.name);
  assert.deepEqual(order, ["Diaz", "Bell", "Cole", "Ford", "Ames", "Eads"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecisions, bandPosition, groupCheckins, hiddenSummary, parseLineup } from "../../web/js/logic.js";

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

test("hiddenSummary always names flagged hidden players", () => {
  const s = hiddenSummary(players, ["LC03", "LC02"]);
  assert.equal(s.hiddenCount, 2);
  assert.deepEqual(s.flagged.map((p) => p.id), ["LC01", "LC25"]);
  assert.match(s.text, /2 others not listed today\. 2 flagged: J\. Ortega \(RP\), M\. Serrano \(OF\)\./);
});

test("hiddenSummary with nothing flagged", () => {
  assert.equal(hiddenSummary(players, ["LC01", "LC25"]).text, "2 others not listed today. None flagged.");
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

test("bandPosition clamps z to the track", () => {
  assert.equal(bandPosition(0), 50);
  assert.equal(bandPosition(-10), 2);
  assert.equal(bandPosition(1), 65);
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

import { jumpPosition, plainChange } from "../../web/js/logic.js";

test("plainChange speaks in percent of his normal", () => {
  assert.equal(plainChange({ rsi: { pct: -12.4 }, magnitude: "▼ large" }), "12% below his normal");
  assert.equal(plainChange({ rsi: { pct: 3.2 }, magnitude: "– within noise" }), "3% above his normal");
  assert.equal(plainChange({ rsi: { pct: 0.4 }, magnitude: "– within noise" }), "Right at his normal");
  assert.equal(plainChange({ rsi: { pct: 1.0 }, magnitude: "▼ large (wellness)" }),
    "1% above his normal · wellness low");
  assert.equal(plainChange({ rsi: { pct: null, today: 0.5 }, magnitude: "" }), "Still learning his normal");
  assert.equal(plainChange({ rsi: { pct: null, today: null }, magnitude: "" }), "No jump today");
});

test("jumpPosition maps -20%..+20% onto the track and clamps", () => {
  assert.equal(jumpPosition(0), 50);
  assert.equal(jumpPosition(-20), 2);
  assert.equal(jumpPosition(10), 74);
  assert.equal(jumpPosition(-40), 2);
});

import { plainReason } from "../../web/js/logic.js";

test("plainReason gives the coach one plain line", () => {
  const p = { pos: "RP", rsi: { pct: -18.3, today: 0.45 }, wellness: { z: -2.3 }, magnitude: "▼ large (wellness)",
    load: { throws_7d: 196 } };
  assert.equal(plainReason(p), "Jump 18% below his normal · wellness low · 196 throws + pitches in 7 days");
  const q = { pos: "OF", rsi: { pct: -9.6, today: 0.5 }, wellness: { z: -0.2 }, magnitude: "▼ moderate", load: {} };
  assert.equal(plainReason(q), "Jump 10% below his normal");
});

test("plainChange says how old a stale jump is", () => {
  const stale = (days_old, pct) => ({ rsi: { pct, today: 0.4, days_old }, magnitude: "▼ large" });
  assert.equal(plainChange(stale(2, -22.4)), "Jump 2 days ago: 22% below his normal");
  assert.equal(plainChange(stale(1, -9.6)), "Jump 1 day ago: 10% below his normal");
  assert.equal(plainChange(stale(3, 0.2)), "Jump 3 days ago: right at his normal");
  assert.equal(plainChange(stale(0, -22.4)), "22% below his normal");
  assert.equal(plainChange({ rsi: { pct: null, today: null, days_old: null }, magnitude: "" }), "No jump today");
  assert.equal(plainChange({ rsi: { pct: null, today: null, days_old: 9 }, magnitude: "" }), "No jump today");
});

test("plainReason does not repeat the word Jump for a stale jump", () => {
  const p = { pos: "OF", rsi: { pct: -22.4, today: 0.4, days_old: 2 }, wellness: { z: -2.3 }, magnitude: "", load: {} };
  assert.equal(plainReason(p), "Jump 2 days ago: 22% below his normal · wellness low");
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

const sumDay = (team_shift, note = "") => ({
  date: "2026-09-20",
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

test("plainSummary on a normal day: date, flagged players with reasons, counts, disclaimer", () => {
  const text = plainSummary(sumDay({ median_pct: 1.0, beyond_noise: false, n: 27 }), sumPlayers, ["LC03"]);
  assert.equal(text, [
    "Lineup Card, Sun Sep 20, vs Lakeside Fictionals (away)",
    "Check in (1): J. Ortega RP, jump 17% below his normal, wellness low, 196 throws + pitches in 7 days",
    "Watch (1): C. Duvall RP, jump 11% below his normal, 185 throws + pitches in 7 days",
    "No change: 1. Not enough data: 1 (K. Ruiz).",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary on a team-shift day leads with the team line and keeps the grouping", () => {
  const text = plainSummary(sumDay({ median_pct: -10.2, beyond_noise: true, n: 27 }, "Road trip: 4 a.m. arrival"),
    sumPlayers, []);
  assert.equal(text, [
    "Lineup Card, Sun Sep 20, vs Lakeside Fictionals (away)",
    "Whole team jumping 10% below normal. Road trip: 4 a.m. arrival.",
    "Not explained by the team drop:",
    "Check in (1): J. Ortega RP, jump 17% below his normal, wellness low, 196 throws + pitches in 7 days",
    "Down with the team (1): C. Duvall.",
    "No change: 1. Not enough data: 1 (K. Ruiz).",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary when nobody is flagged", () => {
  const calm = sumPlayers.map((p) => ({ ...p, status: p.status === "not_enough_data" ? p.status : "no_change" }));
  const text = plainSummary({ ...sumDay(null), date: "2026-09-05" }, calm, []);
  assert.equal(text, [
    "Lineup Card, Sat Sep 5, vs Lakeside Fictionals (away)",
    "Nobody to check in on today.",
    "No change: 3. Not enough data: 1 (K. Ruiz).",
    "Fictional roster. Not a fitness-to-play decision.",
  ].join("\n"));
});

test("plainSummary adds the review note and never shifts the date", () => {
  const p = [{ ...sumPlayers[2], status: "watch", reviewNote: "Changed to Watch: Mentioned hamstring" }];
  const text = plainSummary({ ...sumDay(null), date: "2026-01-01" }, p, []);
  assert.match(text, /^Lineup Card, Thu Jan 1,/);
  assert.match(text, /Watch \(1\): T\. Brandt OF, jump 1% below his normal \(Changed to Watch: Mentioned hamstring\)/);
  assert.match(text, /No change: 0\. Not enough data: 0\./);
});

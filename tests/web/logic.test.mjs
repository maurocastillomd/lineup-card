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

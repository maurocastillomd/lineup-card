import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecisions, bandPosition, hiddenSummary, parseLineup } from "../../web/js/logic.js";

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

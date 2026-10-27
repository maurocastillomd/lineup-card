// The JS core must reproduce the Python day JSON for every fictional day.
// Golden files: scripts/write_parity_golden.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildDays } from "../../web/js/core/run.mjs";

const DATA = new URL("../../data/fictional/", import.meta.url);
const GOLD = new URL("../fixtures/parity/", import.meta.url);

function fictionalFiles() {
  const files = [];
  const add = (name, url) => files.push({ name, text: readFileSync(url, "utf8") });
  add("crosswalk.csv", new URL("crosswalk.csv", DATA));
  add("schedule.csv", new URL("schedule.csv", DATA));
  for (const d of readdirSync(new URL("inbox/", DATA)).sort()) {
    for (const f of ["vald_forcedecks_cmj.csv", "catapult_openfield.csv", "wellness.csv"]) {
      try { add(`${d}/${f}`, new URL(`inbox/${d}/${f}`, DATA)); } catch { /* missing export that day */ }
    }
  }
  return files;
}

// The first path where two JSON values differ, so a failure names the exact field.
function firstDiff(got, want, path = "") {
  if (Object.is(got, want)) return null;
  if (typeof got !== "object" || typeof want !== "object" || got === null || want === null) {
    return `${path || "(root)"}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
  }
  if (Array.isArray(got) !== Array.isArray(want)) return `${path}: array vs object`;
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of keys) {
    if (!(k in got)) return `${path}.${k}: missing in JS`;
    if (!(k in want)) return `${path}.${k}: extra in JS`;
    const d = firstDiff(got[k], want[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

test("every fictional day matches the Python golden file exactly", () => {
  const { days } = buildDays(fictionalFiles(), { name: "Fictional Triple-A Club", synthetic: true }, { showDays: Infinity });
  const golden = readdirSync(GOLD).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(Object.keys(days).sort(), golden.map((f) => f.replace(".json", "")));
  for (const f of golden) {
    const want = JSON.parse(readFileSync(new URL(f, GOLD), "utf8"));
    const got = days[f.replace(".json", "")];
    assert.deepStrictEqual(got, want, `${f} ${firstDiff(got, want)}`);
  }
});

test("buildDays keeps the last 14 days by default and reports the latest", () => {
  const { index } = buildDays(fictionalFiles(), { name: "X", synthetic: true });
  assert.equal(index.dates.length, 14);
  assert.equal(index.latest, index.dates.at(-1));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fmean, fsum, median, pyFixed, pyG, pyInt, pyFloat, pyRound, stdev } from "../../web/js/core/pymath.mjs";
import { addDays, daysBetween, localDayChicago } from "../../web/js/core/dates.mjs";

const V = JSON.parse(readFileSync(new URL("../fixtures/pymath.json", import.meta.url)));

test("pyRound and pyFixed match Python on every vector", () => {
  for (const { x, n, round, fixed } of V.rounds) {
    assert.equal(pyRound(x, n), round, `round(${x}, ${n})`);
    assert.equal(pyFixed(x, n), fixed, `f"{${x}:.${n}f}"`);
  }
});

test("pyG matches Python :g", () => {
  for (const { x, g } of V.g) assert.equal(pyG(x), g, String(x));
});

test("fsum, fmean, median and stdev match Python bit for bit", () => {
  for (const s of V.stats) {
    assert.equal(fsum(s.xs), s.fsum);
    assert.equal(fmean(s.xs), s.fmean);
    assert.equal(median(s.xs), s.median);
    assert.equal(stdev(s.xs), s.stdev, JSON.stringify(s.xs));
  }
});

test("pyInt and pyFloat refuse what Python refuses", () => {
  assert.equal(pyInt(" 3 "), 3);
  assert.throws(() => pyInt("1.0"));
  assert.throws(() => pyInt(""));
  assert.equal(pyFloat("0.448"), 0.448);
  assert.equal(pyFloat("1e3"), 1000);
  assert.throws(() => pyFloat("0x10"));
  assert.throws(() => pyFloat("abc"));
});

test("dates", () => {
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
  assert.equal(daysBetween("2026-09-18", "2026-09-20"), 2);
  assert.equal(localDayChicago("2026-09-21T02:30:00Z"), "2026-09-20");   // 9:30 p.m. CDT
  assert.equal(localDayChicago("2026-09-20T21:05:00+00:00"), "2026-09-20");
  assert.throws(() => localDayChicago("2026-09-20T21:05:00"), /time zone/);
});

// Regression: a 0.0 in the list once made stdev loop forever. Values from Python 3.13.
test("stdev, fmean and median with zeros in the list", () => {
  const cases = [
    { xs: [0.0, 0.448, 0.452], fmean: 0.3, median: 0.448, stdev: 0.2598153190248797 },
    { xs: [0.0, 0.0], fmean: 0.0, median: 0.0, stdev: 0.0 },
    { xs: [0.0, 1e-300, 5.0], fmean: 1.6666666666666667, median: 1e-300, stdev: 2.8867513459481287 },
    { xs: [-0.0, 0.0, 2.5, -2.5], fmean: 0.0, median: 0.0, stdev: 2.041241452319315 },
  ];
  for (const c of cases) {
    const label = JSON.stringify(c.xs);
    assert.equal(fmean(c.xs), c.fmean, label);
    assert.equal(median(c.xs), c.median, label);
    assert.equal(stdev(c.xs), c.stdev, label);
  }
});

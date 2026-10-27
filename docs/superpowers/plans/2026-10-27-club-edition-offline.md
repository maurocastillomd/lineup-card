# Lineup Card Club Edition (offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One HTML file a club staff member double-clicks, drops in VALD / Catapult / wellness exports, reviews flags and prints the Lineup Card, with no install, no network and no AI inside; plus an optional Copilot/ChatGPT prompt pack and a share package.

**Architecture:** Port the Python core (`src/lineup_card/`: adapters, crosswalk, clean, engine, frames, day, pipeline) to plain ES modules in `web/js/core/`. Python stays the reference: a golden file per fictional day, written by Python, must equal the JS output. The existing review and card pages are refactored to take their data from a small "source" object (fetch for the hosted demo, in-memory for offline). A Python build script bundles every module, stylesheet, font, the board SVG, html-to-image and the sample data into `dist/lineup-card.html` behind a Content-Security-Policy that forbids network calls.

**Tech Stack:** Vanilla JS ES modules, `node --test` (Node 24), Python 3.13 + pytest (existing `.venv`), headless Google Chrome for smoke tests and PDFs. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-27-club-edition-offline.md` (approved 2026-10-27).

**Branch:** `club-edition` (from `main` 03e0e05). Never push, merge or send without Mauro's OK.

**Run tests:**
- Python: `.venv/bin/python -m pytest -q`
- Web: `node --test tests/web/*.test.mjs` (a bare directory fails on Node 24)

---

## Parity rules (read before any core task)

Python output is the spec. These details decide whether JS matches it to the last digit:

| Python | JS port | Where |
|---|---|---|
| `round(x, n)` rounds the exact binary value, ties to even | `pyRound(x, n)` | `core/pymath.mjs` |
| `f"{x:.1f}"`, `f"{x:.3f}"` same rounding, as text | `pyFixed(x, n)` | `core/pymath.mjs` |
| `f"{te:g}"` | `pyG(x)` | `core/pymath.mjs` |
| `statistics.fmean` = `math.fsum(xs) / n` | `fmean` on a port of CPython `fsum` | `core/pymath.mjs` |
| `statistics.stdev` = correctly rounded sqrt of the exact sample variance (3.13) | `stdev` with BigInt exact arithmetic | `core/pymath.mjs` |
| `statistics.median` | sort, middle, or mean of the two middles `(a+b)/2` | `core/pymath.mjs` |
| `sum(vals)` (plain) and `+=` | plain left-to-right `+` in the same order | everywhere |
| `sorted()` on tuples of str / ISO dates | compare with `<` on strings, never `localeCompare` | everywhere |
| `date` objects | ISO `YYYY-MM-DD` strings; day arithmetic through `Date.UTC` | `core/dates.mjs` |
| dict insertion order | `Map`, or plain objects with non-numeric keys | everywhere |
| `int("1.0")` raises | `pyInt` accepts only `[+-]?digits` | `core/pymath.mjs` |

**Row order must match Python's folder order.** Python reads `inbox/<date>/` folders in date order and, inside each folder, VALD then Catapult then wellness, cleaning each folder on its own. The browser has no folders, so it makes "virtual folders": it groups each file's rows by their date (VALD `Date`, Catapult local day of `start_time`, wellness `date`) and runs the same per-folder loop. The cleaning log and held-out list come only from today's virtual folder, as in Python.

**Known, documented differences (offline only, never hit by the fictional data):**
1. A Catapult period that starts just after midnight UTC belongs to the local day in the browser. In Python it belongs to the folder it was pulled into.
2. A Catapult `start_time` with no time zone is an error in the browser. Python treats it as the computer's local time.
3. The same row in two different files (two overlapping exports) is kept once in the browser and logged once per source per day as `duplicate_row`, with a count. Python never sees overlaps, because each folder holds one export. "The same row" means the same identity and values, not the same text: VALD `ExternalId`, day, trial, jump height and RSI-mod; Catapult player name (case and spacing ignored, as in the roster match), day, period number, period name, player load, throws and pitches; wellness athlete, day and score. A VALD `Name` spelled two ways still counts once.
4. Files are read in name order (plain character order, like Python's `sorted()`), never in the order they were dropped. So "last wellness form wins" and "first Catapult period wins" give the same card however the files were picked.
5. A row where every cell is blank (Excel often leaves these under the data) is skipped in the browser. Python fails on it.
6. Errors name the file and the spreadsheet row (`w.csv: row 3: ...`, header is row 1). Python's messages do not.
7. `pyFloat` refuses `nan`, `inf` and digits with underscores (`1_000`). Python's `float()` accepts them; a sports export never contains them.
8. More than one schedule file is refused, like more than one roster.

---

## File map

Create:
- `scripts/write_parity_golden.py`: writes Python day JSON for every fictional day.
- `scripts/write_pymath_vectors.py`: writes Python results for the math helpers.
- `tests/fixtures/parity/<date>.json` (36 files) and `tests/fixtures/pymath.json`.
- `tests/test_parity_golden.py`: golden files are current.
- `web/js/core/pymath.mjs`: Python-compatible rounding, formatting, fsum, mean, median, stdev, parsing.
- `web/js/core/dates.mjs`: ISO date helpers and the Chicago local day.
- `web/js/core/csv.mjs`: CSV text to header + row objects.
- `web/js/core/read.mjs`: classify a file; read VALD, Catapult, wellness, roster, schedule, club.
- `web/js/core/clean.mjs`: CleanLog, cleanCmj, cleanCatapult, cleanWellness.
- `web/js/core/engine.mjs`: baseline, z, noise gate, assessDomain, assessAthlete, assessSquad, loadContext.
- `web/js/core/frames.mjs`: typicalError, positionMedians, teamShift, testSensitivity, LEAGUE_REFERENCE.
- `web/js/core/day.mjs`: buildDay (same JSON as `day.py`).
- `web/js/core/run.mjs`: `buildDays(files, club)` = pipeline + `build_site` date selection.
- `web/js/source.js`: the data source for the hosted pages (fetch).
- `web/js/offline.js` and `web/offline.html`: the offline app (load screen + router).
- `web/vendor/html-to-image.js` + `web/vendor/LICENSE-html-to-image.txt`.
- `web/fonts/*.woff2` + `web/fonts/OFL.txt` + `web/css/fonts.css`.
- `scripts/build_offline.py`: bundles everything into `dist/lineup-card.html`.
- `scripts/package_club_edition.py`: builds `dist/club-edition/`.
- `docs/club-edition/how-to-use.html`, `docs/club-edition/it-fact-sheet.html`, `docs/club-edition/COPILOT-CHATGPT-PROMPTS.md`.
- Tests: `tests/web/pymath.test.mjs`, `tests/web/core.test.mjs`, `tests/web/parity.test.mjs`, `tests/web/no-network.test.mjs`, `tests/test_build_offline.py`, `tests/test_offline_smoke.py`.

Modify:
- `web/css/theme.css`: drop the Google Fonts `@import`; import `fonts.css`.
- `web/js/card.js`, `web/js/review.js`: become `init(src)` modules; no top-level fetch.
- `web/js/store.js`: optional club scope in the storage key; reviewer name.
- `web/card.html`, `web/index.html`: call `init(fetchSource())`.
- `.gitignore`: add `dist/`.
- `README.md`: a "Club Edition (offline)" section.

---

### Task 1: Python golden files and math vectors

**Files:**
- Create: `scripts/write_parity_golden.py`, `scripts/write_pymath_vectors.py`, `tests/test_parity_golden.py`
- Create (generated): `tests/fixtures/parity/*.json`, `tests/fixtures/pymath.json`

- [ ] **Step 1: Write the golden writer**

```python
"""Write the Python day JSON for every fictional day with data.

The offline edition's JavaScript core must reproduce these files exactly
(tests/web/parity.test.mjs). Run after any change to src/lineup_card/:
    .venv/bin/python scripts/write_parity_golden.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_site import _has_rows  # noqa: E402
from lineup_card.pipeline import run_day  # noqa: E402

DATA = ROOT / "data" / "fictional"
OUT = ROOT / "tests" / "fixtures" / "parity"


def golden_days() -> dict[str, dict]:
    inbox = DATA / "inbox"
    dates = sorted(p.name for p in inbox.iterdir() if p.is_dir() and _has_rows(p))
    return {d: run_day(DATA, date.fromisoformat(d)) for d in dates}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    days = golden_days()
    for d, day in days.items():
        (OUT / f"{d}.json").write_text(json.dumps(day, indent=1, ensure_ascii=False))
    print(f"wrote {len(days)} golden days to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the math-vector writer**

```python
"""Python results for the helpers the JS core must copy exactly
(tests/web/pymath.test.mjs). Run: .venv/bin/python scripts/write_pymath_vectors.py"""

from __future__ import annotations

import json
import math
import random
import statistics
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "pymath.json"


def main() -> None:
    rng = random.Random(20261027)
    floats = [0.125, 0.375, 2.5, -2.5, 0.045, 1.005, 0.0005, -0.35, 12.345, 0.0, 1e-5]
    floats += [round(rng.uniform(-3, 3), rng.randint(2, 6)) for _ in range(200)]
    floats += [rng.uniform(-3, 3) for _ in range(200)]
    rounds = [{"x": x, "n": n, "round": round(x, n), "fixed": f"{x:.{n}f}"}
              for x in floats for n in (0, 1, 2, 3, 4)]
    gs = [{"x": x, "g": f"{x:g}"} for x in [0.0312, 0.05, 1.0, 0.1234, 2.0, 0.0001, 12.5, 1e-5]]
    sets = [[0.448, 0.452, 0.439], [0.1, 0.2, 0.3], [1e16, 1.0, -1e16]]
    sets += [[round(rng.gauss(0.45, 0.04), 3) for _ in range(rng.randint(2, 30))] for _ in range(100)]
    sets += [[float(rng.randint(10, 25)) for _ in range(rng.randint(2, 30))] for _ in range(50)]
    stats = [{"xs": xs, "fsum": math.fsum(xs), "fmean": statistics.fmean(xs),
              "median": statistics.median(xs), "stdev": statistics.stdev(xs)} for xs in sets]
    OUT.write_text(json.dumps({"rounds": rounds, "g": gs, "stats": stats}))
    print(f"wrote {len(rounds)} rounds, {len(gs)} g, {len(stats)} stat sets")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write the "golden is current" test**

```python
"""The parity golden files must match what the Python core produces now,
so the JS port is always compared against the current reference."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from write_parity_golden import OUT, golden_days  # noqa: E402


def test_golden_files_are_current():
    days = golden_days()
    on_disk = sorted(p.stem for p in OUT.glob("*.json"))
    assert on_disk == sorted(days), "run scripts/write_parity_golden.py"
    for d, day in days.items():
        assert json.loads((OUT / f"{d}.json").read_text()) == json.loads(json.dumps(day)), d
```

- [ ] **Step 4: Run it to see it fail**

Run: `.venv/bin/python -m pytest tests/test_parity_golden.py -q`
Expected: FAIL, "run scripts/write_parity_golden.py" (no files yet).

- [ ] **Step 5: Generate and re-run**

Run: `.venv/bin/python scripts/write_parity_golden.py && .venv/bin/python scripts/write_pymath_vectors.py && .venv/bin/python -m pytest -q`
Expected: `wrote 36 golden days`; then all tests pass (173 + 1).

- [ ] **Step 6: Commit**

```bash
git add scripts/write_parity_golden.py scripts/write_pymath_vectors.py tests/test_parity_golden.py tests/fixtures/parity tests/fixtures/pymath.json
git commit -m "test: Python golden days and math vectors for the offline port"
```

---

### Task 2: Python-compatible math (`core/pymath.mjs`, `core/dates.mjs`)

**Files:**
- Create: `web/js/core/pymath.mjs`, `web/js/core/dates.mjs`
- Test: `tests/web/pymath.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/web/pymath.test.mjs`
Expected: FAIL, cannot find module `pymath.mjs`.

- [ ] **Step 3: Write `web/js/core/pymath.mjs`**

```js
// Python-compatible number helpers. The offline edition must give the same
// numbers as the Python reference (src/lineup_card), to the last digit, so
// rounding, sums and SD copy CPython's exact behaviour.

// round(x, n): round the exact binary value, ties to even (CPython).
export function pyRound(x, n = 0) {
  return Number(pyFixed(x, n));
}

// f"{x:.nf}" as text, same rounding as round().
export function pyFixed(x, n) {
  if (!Number.isFinite(x)) throw new Error("finite numbers only");
  const neg = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(100);           // exact for every value we meet
  const [whole, frac] = exact.split(".");
  const tail = frac.slice(n);
  const tie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  let out;
  if (tie) {
    const kept = n ? `${whole}.${frac.slice(0, n)}` : whole;
    const last = Number(kept[kept.length - 1]);
    out = last % 2 === 0 ? kept : Math.abs(x).toFixed(n);     // even stays; odd rounds up
  } else {
    out = Math.abs(x).toFixed(n);
  }
  const isZero = /^[0.]*$/.test(out);
  return (neg && !isZero) || (neg && Object.is(x, -0)) ? `-${out}` : out;
}

// f"{x:g}": 6 significant digits, trailing zeros removed.
export function pyG(x) {
  if (x === 0) return "0";
  const exp = Number(Math.abs(x).toExponential(5).split("e")[1]);
  if (exp < -4 || exp >= 6) {
    let [m, e] = x.toExponential(5).split("e");
    m = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const sign = e[0] === "-" ? "-" : "+";
    return `${m}e${sign}${e.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  const s = pyFixed(x, Math.max(0, 5 - exp));
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

// math.fsum: CPython's exactly rounded sum (Shewchuk partials).
export function fsum(xs) {
  const p = [];
  for (let x of xs) {
    let i = 0;
    for (let y of p) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) p[i++] = lo;
      x = hi;
    }
    p.length = i;
    p.push(x);
  }
  let n = p.length;
  if (n === 0) return 0;
  let hi = p[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = p[--n];
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}

export const fmean = (xs) => {
  if (!xs.length) throw new Error("fmean requires at least one data point");
  return fsum(xs) / xs.length;
};

export function median(xs) {
  if (!xs.length) throw new Error("no median for empty data");
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A double as k * 2**e with k a BigInt, exactly.
function exact(x) {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const hi = v.getUint32(0);
  const lo = v.getUint32(4);
  const bits = (hi >>> 20) & 0x7ff;
  let k = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (bits === 0) e = -1074;
  else { k |= 1n << 52n; e = bits - 1075; }
  if (hi >>> 31) k = -k;
  return { k, e };
}

// Does y*y compare to p/q? -1, 0 or 1. y >= 0, p >= 0, q > 0.
function cmpSquare(y, p, q) {
  const { k, e } = exact(y);
  let left = k * k * q;          // y^2 * q = k^2 * 2^(2e) * q
  let right = p;
  if (e >= 0) left <<= BigInt(2 * e); else right <<= BigInt(-2 * e);
  return left < right ? -1 : left > right ? 1 : 0;
}

const nextUp = (y) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, y);
  v.setBigUint64(0, v.getBigUint64(0) + 1n);
  return v.getFloat64(0);
};
const nextDown = (y) => {
  if (y === 0) return 0;
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, y);
  v.setBigUint64(0, v.getBigUint64(0) - 1n);
  return v.getFloat64(0);
};

// Correctly rounded sqrt(p / q) for BigInt p >= 0, q > 0.
function sqrtFrac(p, q) {
  let y = Math.sqrt(Number(p) / Number(q));
  while (y > 0 && cmpSquare(y, p, q) > 0) y = nextDown(y);
  while (cmpSquare(nextUp(y), p, q) <= 0) y = nextUp(y);
  // now y^2 <= p/q < next^2: pick the nearer of y and next by the midpoint
  const up = nextUp(y);
  const mid = exact(y);                      // midpoint = (y + up) / 2, exactly
  const m = exact(up);
  const shift = BigInt(mid.e - m.e);
  const [ka, kb, e] = mid.e >= m.e ? [mid.k << shift, m.k, m.e] : [mid.k, m.k << -shift, mid.e];
  const midK = ka + kb;                      // midpoint = midK * 2^(e-1)
  let left = midK * midK * q;                // mid^2 * q vs p, scaled by 2^(2e-2)
  let right = p;
  const s = 2 * (e - 1);
  if (s >= 0) left <<= BigInt(s); else right <<= BigInt(-s);
  if (right < left) return y;
  if (right > left) return up;
  return (exact(y).k & 1n) === 0n ? y : up;  // exact tie: even mantissa
}

// statistics.stdev (Python 3.13): sqrt of the exact sample variance, correctly rounded.
export function stdev(xs) {
  const n = xs.length;
  if (n < 2) throw new Error("stdev requires at least two data points");
  const parts = xs.map(exact);
  const E = Math.min(...parts.map((p) => p.e));
  const ks = parts.map((p) => p.k << BigInt(p.e - E));
  let S = 0n;
  let Q = 0n;
  for (const k of ks) { S += k; Q += k * k; }
  const N = BigInt(n);
  const p = N * Q - S * S;                   // n(n-1) * variance / 2^(2E)
  const q = N * (N - 1n);
  return sqrtFrac(p, q) * 2 ** E;
}

export function pyInt(cell) {
  const s = String(cell).trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`invalid whole number '${cell}'`);
  return Number(s);
}

export function pyFloat(cell) {
  const s = String(cell).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) throw new Error(`invalid number '${cell}'`);
  return Number(s);
}
```

Note on `stdev * 2 ** E`: multiplying by a power of two is exact unless the result is subnormal, which never happens for these measures.

- [ ] **Step 4: Write `web/js/core/dates.mjs`**

```js
// Dates are ISO "YYYY-MM-DD" strings everywhere. Day arithmetic goes through
// UTC midnights so daylight-saving changes never shift a day.

const DAY_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(cell) {
  const s = String(cell).trim();
  if (!ISO.test(s)) throw new Error(`invalid date '${cell}' (use YYYY-MM-DD)`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new Error(`invalid date '${cell}'`);
  return s;
}

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY_MS);

const CHICAGO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

// The club's local date for a UTC timestamp, so a 7 p.m. game is not tomorrow.
export function localDayChicago(stamp) {
  const s = String(stamp).trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) throw new Error(`start_time '${stamp}' needs a time zone (Z or +00:00)`);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`invalid start_time '${stamp}'`);
  return CHICAGO.format(new Date(t));
}
```

- [ ] **Step 5: Run the test**

Run: `node --test tests/web/pymath.test.mjs`
Expected: PASS (5 tests). If one `stdev` or `pyFixed` vector fails, the failure message names the input. Fix the helper, never the vector.

- [ ] **Step 6: Commit**

```bash
git add web/js/core/pymath.mjs web/js/core/dates.mjs tests/web/pymath.test.mjs
git commit -m "feat(core): Python-compatible rounding, fsum, stdev and dates in JS"
```

---

### Task 3: CSV and readers (`core/csv.mjs`, `core/read.mjs`)

**Files:**
- Create: `web/js/core/csv.mjs`, `web/js/core/read.mjs`
- Test: `tests/web/core.test.mjs` (new file; Tasks 4 to 6 add to it)

Port the readers line for line from `src/lineup_card/adapters/vald.py`, `catapult.py`, `wellness.py`, `headers.py` and `crosswalk.py`. Error messages keep the Python wording, so the README's troubleshooting applies to both editions.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../web/js/core/csv.mjs";
import { classify, readCatapult, readCrosswalk, readVald, readWellness } from "../../web/js/core/read.mjs";

const VALD = "﻿Name,ExternalId,Date,Time,Test Type,Trial,Jump Height (Imp-Mom) [cm],RSI-modified [m/s]\r\n" +
  "J. Ortega,V010,2026-09-20,07:41,CMJ,1,33.9,0.448\r\nJ. Ortega,V010,2026-09-20,07:42,SJ,1,30.0,0.400\r\n";

test("parseCsv strips the BOM, handles CRLF and quoted commas", () => {
  const { headers, rows } = parseCsv('a,b\r\n"x, y",2\r\n');
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "x, y", b: "2" }]);
  assert.deepEqual(parseCsv("﻿a\n1\n").headers, ["a"]);
});

test("classify tells the five files apart by their headers", () => {
  assert.equal(classify(parseCsv(VALD).headers), "vald");
  assert.equal(classify(["player_name", "period_name", "period_number", "start_time", "player_load", "throw_count", "pitch_count"]), "catapult");
  assert.equal(classify(["athlete_id", "date", "sleep_quality", "soreness", "fatigue", "stress", "mood"]), "wellness");
  assert.equal(classify(["lc_id", "name", "pos", "vald_external_id", "catapult_name"]), "roster");
  assert.equal(classify(["date", "opponent", "home_away", "note"]), "schedule");
  assert.equal(classify(["foo"]), null);
});

test("readVald keeps CMJ rows only and reads units from the header", () => {
  const rows = readVald(parseCsv(VALD));
  assert.deepEqual(rows, [{ name: "J. Ortega", external_id: "V010", day: "2026-09-20", trial: 1, jump_height_cm: 33.9, rsi_mod: 0.448 }]);
  const inches = VALD.replace("[cm]", "[in]");
  assert.throws(() => readVald(parseCsv(inches)), /has unit \[in\], expected \[cm\]/);
});

test("readCatapult uses the club's local day; blank stays missing", () => {
  const csv = "player_name,period_name,period_number,start_time,end_time,duration,player_load,throw_count,pitch_count\n" +
    "Jorge Ortega,Game,2,2026-09-21T01:10:00Z,,,410.5,,12\n";
  assert.deepEqual(readCatapult(parseCsv(csv)), [{ player_name: "Jorge Ortega", period_name: "Game", period_number: 2,
    day: "2026-09-20", player_load: 410.5, throw_count: null, pitch_count: 12 }]);
});

test("readWellness sums five items; a skipped item means no score", () => {
  const csv = "athlete_id,date,sleep_quality,soreness,fatigue,stress,mood\nLC01,2026-09-20,2,4,3,4,3\nLC02,2026-09-20,5,,5,5,5\n";
  assert.deepEqual(readWellness(parseCsv(csv)).map((r) => r.score), [16, null]);
  assert.throws(() => readWellness(parseCsv(csv.replace("2,4,3,4,3", "6,4,3,4,3"))), /1 to 5/);
});

test("readCrosswalk refuses duplicates and unknown positions", () => {
  const head = "lc_id,name,pos,vald_external_id,catapult_name\n";
  const cw = readCrosswalk(parseCsv(head + "LC01,J. Ortega,RP,V010,Jorge  Ortega\n"));
  assert.equal(cw.fromVald(" V010 "), "LC01");
  assert.equal(cw.fromCatapult("jorge ortega"), "LC01");
  assert.throws(() => readCrosswalk(parseCsv(head + "LC01,A,P,V1,A\n")), /Unknown position/);
  assert.throws(() => readCrosswalk(parseCsv(head + "LC01,A,RP,V1,A\nLC01,B,RP,V2,B\n")), /duplicate Lineup Card ID/);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/core.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/js/core/csv.mjs`**

```js
// CSV text -> { headers, rows } with rows as objects keyed by header, like
// Python's csv.DictReader with encoding="utf-8-sig". Handles quotes, "" escapes,
// commas and newlines inside quotes, CRLF, and a leading BOM. Blank lines skipped.

export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v !== "") || row.length > 1) records.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); records.push(row); }
  const headers = records.shift() ?? [];
  const rows = records.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}
```

- [ ] **Step 4: Write `web/js/core/read.mjs`**

```js
// Vendor exports -> plain records. Ported from src/lineup_card/adapters/*.py and
// crosswalk.py; messages keep the Python wording. A blank cell is missing, never zero.

import { isoDate, localDayChicago } from "./dates.mjs";
import { pyFloat, pyInt } from "./pymath.mjs";

const has = (headers, cols) => cols.every((c) => headers.includes(c));
const missingCols = (headers, cols) => cols.filter((c) => !headers.includes(c)).sort();

export function classify(headers) {
  if (has(headers, ["ExternalId", "Test Type", "Trial"])) return "vald";
  if (has(headers, ["player_name", "period_number", "start_time"])) return "catapult";
  if (has(headers, ["athlete_id", "sleep_quality"])) return "wellness";
  if (has(headers, ["lc_id", "vald_external_id", "catapult_name"])) return "roster";
  if (has(headers, ["date", "opponent", "home_away"])) return "schedule";
  return null;
}

// ---- headers.py ----
const KNOWN_UNITS = new Set(["cm", "in", "m/s", "s", "N", "Ns", "W", "kg", "AU"]);
const HEADER = /^(.*?)\s*\[([^\]]+)\]\s*$/;

export function parseHeader(header) {
  const m = HEADER.exec(header.trim());
  return m ? [m[1], m[2]] : [header.trim(), null];
}

export function findColumn(headers, name, unit) {
  for (const header of headers) {
    const [foundName, foundUnit] = parseHeader(header);
    if (foundName !== name) continue;
    if (!KNOWN_UNITS.has(foundUnit)) throw new Error(`Unknown unit [${foundUnit}] in column '${header}'`);
    if (foundUnit !== unit) throw new Error(`Column '${header}' has unit [${foundUnit}], expected [${unit}]`);
    return header;
  }
  throw new Error(`Export is missing the column '${name} [${unit}]'`);
}

const num = (cell) => { const s = (cell ?? "").trim(); return s ? pyFloat(s) : null; };

// ---- vald.py ----
export function readVald({ headers, rows }) {
  const missing = missingCols(headers, ["Name", "ExternalId", "Date", "Test Type", "Trial"]);
  if (missing.length) throw new Error("VALD export is missing columns: " + missing.join(", "));
  const jump = findColumn(headers, "Jump Height (Imp-Mom)", "cm");
  const rsi = findColumn(headers, "RSI-modified", "m/s");
  return rows.filter((r) => r["Test Type"].trim().toUpperCase() === "CMJ").map((r) => ({
    name: r.Name.trim(), external_id: r.ExternalId.trim(), day: isoDate(r.Date),
    trial: pyInt(r.Trial), jump_height_cm: num(r[jump]), rsi_mod: num(r[rsi]),
  }));
}

// ---- catapult.py ----
const CATAPULT = ["player_name", "period_name", "period_number", "start_time", "player_load", "throw_count", "pitch_count"];
export function readCatapult({ headers, rows }) {
  const missing = missingCols(headers, CATAPULT);
  if (missing.length) throw new Error("Catapult export is missing columns: " + missing.join(", "));
  const int = (cell) => { const v = num(cell); return v === null ? null : Math.trunc(v); };   // Python int(float)
  return rows.map((r) => ({
    player_name: r.player_name.trim(), period_name: r.period_name.trim(),
    period_number: pyInt(r.period_number), day: localDayChicago(r.start_time),
    player_load: num(r.player_load), throw_count: int(r.throw_count), pitch_count: int(r.pitch_count),
  }));
}

// ---- wellness.py ----
const ITEMS = ["sleep_quality", "soreness", "fatigue", "stress", "mood"];
export function readWellness({ headers, rows }) {
  const missing = missingCols(headers, ["athlete_id", "date", ...ITEMS]);
  if (missing.length) throw new Error("Wellness file is missing columns: " + missing.join(", "));
  return rows.map((r) => {
    const cells = ITEMS.map((i) => r[i].trim());
    let score = null;
    if (cells.every(Boolean)) {
      const values = cells.map(pyInt);
      if (values.some((v) => v < 1 || v > 5)) throw new Error("Wellness items must be 1 to 5");
      score = values.reduce((a, b) => a + b, 0);
    }
    return { athlete_id: r.athlete_id.trim(), day: isoDate(r.date), score };
  });
}

// ---- crosswalk.py ----
export const POSITIONS = ["SP", "RP", "C", "IF", "OF"];
const key = (text) => text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

export function readCrosswalk({ rows }) {
  const players = new Map();
  const vald = new Map();
  const catapult = new Map();
  for (const r of rows) {
    const id = r.lc_id.trim();
    const pos = r.pos.trim();
    if (!POSITIONS.includes(pos)) throw new Error(`Unknown position '${r.pos}' for ${id}`);
    if (players.has(id)) throw new Error(`duplicate Lineup Card ID ${id}`);
    players.set(id, { lc_id: id, name: r.name.trim(), pos });
    for (const [table, raw] of [[vald, r.vald_external_id.trim()], [catapult, key(r.catapult_name)]]) {
      if (table.has(raw)) throw new Error(`duplicate source identity '${raw}'`);
      table.set(raw, id);
    }
  }
  return {
    players,
    fromVald: (externalId) => vald.get(externalId.trim()) ?? null,
    fromCatapult: (name) => catapult.get(key(name)) ?? null,
    player: (id) => players.get(id),
  };
}

// ---- pipeline.py _schedule ----
export function readSchedule({ rows }) {
  return new Map(rows.map((r) => [r.date, { opponent: r.opponent, home_away: r.home_away, note: r.note ?? "" }]));
}
```

Python's `int(float("12.0"))` truncates toward zero, hence `Math.trunc`. Python's `str.split()` with no argument splits on any whitespace and drops empties, hence `key`.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/web/core.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add web/js/core/csv.mjs web/js/core/read.mjs tests/web/core.test.mjs
git commit -m "feat(core): CSV parser and export readers ported from Python"
```

---

### Task 4: Cleaning (`core/clean.mjs`)

**Files:**
- Create: `web/js/core/clean.mjs`
- Test: append to `tests/web/core.test.mjs`

Port `src/lineup_card/clean.py`. A Reading is `{ athlete_id, name, pos, day, metric, value, source }`. `makeReading` copies the pydantic checks: known metric, finite, not negative.

- [ ] **Step 1: Append the failing tests**

```js
import { CleanLog, cleanCatapult, cleanCmj, cleanWellness } from "../../web/js/core/clean.mjs";

const cw = readCrosswalk(parseCsv("lc_id,name,pos,vald_external_id,catapult_name\nLC01,J. Ortega,RP,V010,Jorge Ortega\n"));
const trial = (t, rsi, jump = 30) => ({ name: "J. Ortega", external_id: "V010", day: "2026-09-20", trial: t, jump_height_cm: jump, rsi_mod: rsi });

test("cleanCmj drops a trial >10% from the median and means the rest", () => {
  const log = new CleanLog();
  const out = cleanCmj([trial(1, 0.45), trial(2, 0.46), trial(3, 0.30)], cw, log);
  assert.deepEqual(out.map((r) => [r.metric, r.value]), [["rsi_mod", (0.45 + 0.46) / 2], ["jump_height_cm", 30]]);
  assert.equal(log.entries[0].rule, "trial_outlier");
  assert.match(log.entries[0].detail, /RSI-mod trial 0\.300 more than 10%/);
});

test("cleanCmj holds out an unknown athlete and logs too few trials", () => {
  const log = new CleanLog();
  assert.deepEqual(cleanCmj([{ ...trial(1, 0.4), external_id: "V999" }], cw, log), []);
  assert.deepEqual(log.held_out, [{ source: "vald", raw: "V999", reason: "not in crosswalk" }]);
  cleanCmj([trial(1, 0.45)], cw, log);
  assert.equal(log.entries.at(-1).rule, "too_few_trials");
});

test("cleanCatapult sums periods, skips totals, counts a duplicate once", () => {
  const p = (n, name, load) => ({ player_name: "Jorge Ortega", period_name: name, period_number: n, day: "2026-09-20", player_load: load, throw_count: 10, pitch_count: null });
  const log = new CleanLog();
  const out = cleanCatapult([p(1, "Warm-up", 60), p(2, "Game", 300), p(2, "Game", 300), p(9, "Session Total", 999)], cw, log);
  assert.deepEqual(out.map((r) => [r.metric, r.value]), [["player_load", 360], ["throw_count", 20]]);
  assert.equal(log.entries[0].rule, "duplicate_period");
});

test("cleanWellness keeps the last form and logs incomplete ones", () => {
  const log = new CleanLog();
  const out = cleanWellness([{ athlete_id: "LC01", day: "2026-09-20", score: 15 }, { athlete_id: "LC01", day: "2026-09-20", score: 18 }], cw, log);
  assert.deepEqual(out.map((r) => r.value), [18]);
  assert.equal(log.entries[0].rule, "duplicate_form");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/core.test.mjs`
Expected: FAIL, `clean.mjs` not found.

- [ ] **Step 3: Write `web/js/core/clean.mjs`**

```js
// Cleaning rules, ported from src/lineup_card/clean.py. Every decision goes in
// the CleanLog so the coach sees it on the review screen.

import { fmean, median, pyFixed } from "./pymath.mjs";

const OUTLIER_FRACTION = 0.10;
const MIN_TRIALS = 2;
export const METRIC_NAMES = new Set(["wellness_score", "rsi_mod", "jump_height_cm", "player_load", "throw_count", "pitch_count"]);

export class CleanLog {
  constructor() { this.entries = []; this.held_out = []; }
  add(lc_id, day, source, rule, detail) { this.entries.push({ lc_id, day, source, rule, detail }); }
  hold(source, raw) {
    if (!this.held_out.some((h) => h.source === source && h.raw === raw)) this.held_out.push({ source, raw, reason: "not in crosswalk" });
  }
}

export function makeReading(cw, lc_id, day, metric, value, source) {
  if (!METRIC_NAMES.has(metric)) throw new Error("Unknown metric; map export columns to an engine metric");
  if (!Number.isFinite(value)) throw new Error("Reading values must be finite");
  if (value < 0) throw new Error("This metric cannot be negative");
  const p = cw.player(lc_id);
  return { athlete_id: lc_id, name: p.name, pos: p.pos, day, metric, value, source };
}

const tupleCmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

export function cleanCmj(trials, cw, log) {
  const groups = new Map();
  for (const t of trials) {
    const id = cw.fromVald(t.external_id);
    if (id === null) { log.hold("vald", t.external_id); continue; }
    const k = `${id}\u0000${t.day}`;
    if (!groups.has(k)) groups.set(k, { id, day: t.day, group: [] });
    groups.get(k).group.push(t);
  }
  const out = [];
  for (const { id, day, group } of [...groups.values()].sort((a, b) => tupleCmp([a.id, a.day], [b.id, b.day]))) {
    const rsi = group.map((t) => t.rsi_mod).filter((v) => v !== null);
    if (!rsi.length) continue;
    const m = median(rsi);
    const keep = rsi.filter((v) => Math.abs(v - m) <= OUTLIER_FRACTION * m);
    const drop = rsi.filter((v) => !keep.includes(v));
    for (const v of drop) log.add(id, day, "vald", "trial_outlier", `RSI-mod trial ${pyFixed(v, 3)} more than 10% from the set median; dropped`);
    if (keep.length < MIN_TRIALS) {
      log.add(id, day, "vald", "too_few_trials", `${keep.length} valid CMJ trial(s); no value recorded today`);
      continue;
    }
    out.push(makeReading(cw, id, day, "rsi_mod", fmean(keep), "vald"));
    const jumps = group.filter((t) => keep.includes(t.rsi_mod) && t.jump_height_cm !== null).map((t) => t.jump_height_cm);
    if (jumps.length) out.push(makeReading(cw, id, day, "jump_height_cm", fmean(jumps), "vald"));
  }
  return out;
}

export function cleanCatapult(periods, cw, log) {
  const sums = new Map();
  const seen = new Set();
  for (const p of periods) {
    if (p.period_name.toLowerCase().includes("total")) continue;
    const id = cw.fromCatapult(p.player_name);
    if (id === null) { log.hold("catapult", p.player_name); continue; }
    const pk = `${id}\u0000${p.day}\u0000${p.period_number}`;
    if (seen.has(pk)) { log.add(id, p.day, "catapult", "duplicate_period", `duplicate Catapult period ${p.period_number}; counted once`); continue; }
    seen.add(pk);
    for (const [metric, value] of [["player_load", p.player_load], ["throw_count", p.throw_count], ["pitch_count", p.pitch_count]]) {
      if (value === null) continue;
      const k = `${id}\u0000${p.day}\u0000${metric}`;
      if (!sums.has(k)) sums.set(k, { id, day: p.day, metric, value: 0 });
      sums.get(k).value += value;
    }
  }
  return [...sums.values()].sort((a, b) => tupleCmp([a.id, a.day, a.metric], [b.id, b.day, b.metric]))
    .map((s) => makeReading(cw, s.id, s.day, s.metric, s.value, "catapult"));
}

export function cleanWellness(rows, cw, log) {
  const last = new Map();
  for (const r of rows) {
    const k = `${r.athlete_id}\u0000${r.day}`;
    if (last.has(k) && cw.players.has(r.athlete_id)) log.add(r.athlete_id, r.day, "wellness", "duplicate_form", "duplicate wellness form; kept the last one");
    last.set(k, r);   // a Map keeps the first insertion position, like a Python dict
  }
  const out = [];
  for (const r of last.values()) {
    if (!cw.players.has(r.athlete_id)) { log.hold("wellness", r.athlete_id); continue; }
    if (r.score === null) { log.add(r.athlete_id, r.day, "wellness", "incomplete_form", "wellness form incomplete; no score today"); continue; }
    out.push(makeReading(cw, r.athlete_id, r.day, "wellness_score", r.score, "wellness"));
  }
  return out;
}
```

Python's `sums` is a `defaultdict(float)` starting at `0.0`, and `0 + x` equals `0.0 + x` in JS, so the sums match.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/web/core.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add web/js/core/clean.mjs tests/web/core.test.mjs
git commit -m "feat(core): cleaning rules ported from Python"
```

---

### Task 5: Engine and frames (`core/engine.mjs`, `core/frames.mjs`)

**Files:**
- Create: `web/js/core/engine.mjs`, `web/js/core/frames.mjs`
- Test: append to `tests/web/core.test.mjs`

Port `src/lineup_card/engine.py` and `frames.py` function by function, keeping names in camelCase (`assess_domain` becomes `assessDomain`). Status values stay the Python strings: `"review"`, `"monitor"`, `"cleared"`, `"insufficient_data"`. A DomainAssessment is a plain object with the same fields as the pydantic model, `base` being `{ mean, sd, n, swc }` or `null`. The rules and constants are in the engine docstring; copy that docstring as the file's header comment.

- [ ] **Step 1: Append the failing tests (values from `tests/test_engine.py` cases)**

```js
import { assessDomain, METRICS, noiseThreshold } from "../../web/js/core/engine.mjs";
import { teamShift, testSensitivity, typicalError } from "../../web/js/core/frames.mjs";
import { addDays } from "../../web/js/core/dates.mjs";

const series = (vals, end = "2026-09-20") => vals.map((v, i) => [addDays(end, i - vals.length + 1), v]);
const steady = [0.45, 0.46, 0.44, 0.45, 0.47, 0.45, 0.44, 0.46, 0.45, 0.46, 0.45, 0.44];

test("assessDomain flags a large drop as review", () => {
  const d = assessDomain(METRICS.neuromuscular, series([...steady, 0.38]), "2026-09-20");
  assert.equal(d.status, "review");
  assert.match(d.reasons[0], /RSI-mod \d\.\d SD below his 28-day normal; test noise not yet estimated/);
});

test("the 1.5 x TE gate turns a small drop into no change", () => {
  const d = assessDomain(METRICS.neuromuscular, series([...steady, 0.43]), "2026-09-20", 0.05);
  assert.equal(d.status, "cleared");
  assert.equal(d.reasons[0], "RSI-mod drop inside test noise (TE 0.05 m/s)");
  assert.equal(noiseThreshold(0.02), 0.03);
});

test("fewer than 10 readings is baseline-building", () => {
  const d = assessDomain(METRICS.neuromuscular, series(steady.slice(0, 5)), "2026-09-20");
  assert.equal(d.status, "insufficient_data");
  assert.deepEqual(d.reasons, ["baseline-building"]);
});

test("team shift only on a drop beyond the gate", () => {
  assert.equal(teamShift([-0.05, -0.06, -0.04], [-10, -12, -9], 0.02).beyond_noise, true);
  assert.equal(teamShift([0.05, 0.06, 0.04], [10, 12, 9], 0.02).beyond_noise, false);
  assert.equal(teamShift([], [], 0.02), null);
});

test("typicalError needs 10 pairs; testSensitivity rates SWC/TE", () => {
  assert.equal(typicalError([], "rsi_mod", "2026-09-20"), null);
  assert.equal(testSensitivity([0.4, 0.5], 0.01).rating, "good");
  assert.equal(testSensitivity([0.4], 0.01), null);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/core.test.mjs`
Expected: FAIL, `engine.mjs` not found.

- [ ] **Step 3: Write `web/js/core/engine.mjs`**

Copy every constant from `engine.py`: `BASELINE_DAYS = 28`, `MIN_BASELINE_SESSIONS = 10`, `FRESHNESS_DAYS = 4`, `LOAD_DAYS = 7`, `NOISE_GATE_MULTIPLIER = 1.5`, `REVIEW_Z = -2.0`, `MONITOR_Z = -1.2`, `CONVERGENCE_Z = -1.2`, `MONITOR_DECLINE_SESSIONS = 3`, `TREND_SESSIONS = 14`, `SWC_FACTOR = 0.2`, and `SEVERITY = { review: 0, monitor: 1, insufficient_data: 2, cleared: 3 }`.

```js
export const METRICS = {
  perceptual: { domain: "perceptual", column: "wellness_score", label: "Wellness", unit: "pts", higher_is_worse: false, rolling_days: 1 },
  neuromuscular: { domain: "neuromuscular", column: "rsi_mod", label: "RSI-mod", unit: "m/s", higher_is_worse: false, rolling_days: 1 },
};
export const METRIC_ORDER = ["perceptual", "neuromuscular"];   // Python dict order of METRICS
export const goodness = (v, higherIsWorse) => (higherIsWorse ? -v : v);

export function computeBaseline(values) {
  if (!values.every(Number.isFinite)) throw new Error("Baseline values must be finite");
  if (values.length < MIN_BASELINE_SESSIONS) return null;
  const mean = fmean(values);
  const sd = stdev(values);
  if (sd === 0 || !Number.isFinite(sd) || !Number.isFinite(mean)) return null;
  return { mean, sd, n: values.length, swc: SWC_FACTOR * sd };
}
export const zScore = (today, base) => (today - base.mean) / base.sd;
export const noiseThreshold = (te) => NOISE_GATE_MULTIPLIER * te;   // Mauro's rule, 2026-10-21
```

Then port, in this order, with the same arithmetic order as Python:
- `rolling(points, days)`: `points` is an array of `[isoDay, value]`.
- `countConsecutiveDeclines(values)`.
- `assessDomain(spec, points, today, te = null)`: copy the body exactly. Notes:
  - `fresh_pts`: `addDays(today, -FRESHNESS_DAYS) <= d && d <= today` as string compares.
  - `round(today_val, 2)` in the baseline-building branch and `round(today_val, 3)` at the end use `pyRound`.
  - Reason text uses `pyFixed(Math.abs(z), 1)` for `{abs(decline_z):.1f}` and `pyG(te)` for `{te:g}`.
  - `pct` is `pyRound((today_val - raw_mean) / raw_mean * 100.0, 1)`, or `null` when `raw_mean === 0`.
  - `beyond_noise` is `null` when `te` is `null`, else `drop > noiseThreshold(te)`.
  - The duplicate-day check throws `"Multiple values for one metric-day need explicit aggregation"`.
- `metricSeries(readings, metric, today)`: build a `Map` day to value and throw the same "Conflicting values" message. Return entries sorted by day.
- `loadContext(readings, today)`:
  - `on(metric, day)` = plain `reduce((a, b) => a + b, 0)` over the matching values, or `null` when there are none. Python's `sum` starts from int 0, the same result.
  - `_int_or_none` is `pyRound(v, 0)`.
  - Return `{ player_load_today, throws_today, pitches_today, throws_7d }` in that key order. This is the pydantic field order, and `model_dump()` keeps it.
- `assessAthlete(readings, today, te = {})`: identities check, `ident` from the latest reading, domains in `METRIC_ORDER`, convergence, drivers, reasons with `` `${converging.length} response domains at or below z ${pyFixed(CONVERGENCE_Z, 1)}; convergence review rule` ``, and the "Incomplete response-domain coverage..." line. `assessable(d)` is `d.fresh && d.decline_z !== null`.
- `assessSquad(readings, today, te)`: group by `athlete_id` in first-seen order (a `Map`), drop `null`s, then stable sort by `[SEVERITY[status], worstZ]`. `worstZ` is `Math.min` of the non-null `decline_z`, else `0`.

- [ ] **Step 4: Write `web/js/core/frames.mjs`**

Port `frames.py`:
- `BASELINE_DAYS`, `MIN_PAIRS = 10`, `LEAGUE_REFERENCE` (identical object and key order).
- `typicalError(readings, metric, today)`: group by athlete in first-seen order; within each, sort by day; append the differences in that order; `pyRound(stdev(diffs) / 2 ** 0.5, 4)`.
- `positionMedians(zById, posById)`: groups in the first-seen order of `zById` entries; `{ median_z: pyRound(median(zs), 2), n }`.
- `teamShift(raw, pct, te)`: exactly as Python, with `pyRound` 1 and 4.
- `MDC95_FACTOR = 1.96 * 2 ** 0.5`.
- `testSensitivity(playerMeans, te)`: returns the same keys in the same order (`n, grand_mean, between_sd, te, cv_pct, swc, swc_te, mdc95, gate, rating`).

- [ ] **Step 5: Run the tests**

Run: `node --test tests/web/core.test.mjs`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add web/js/core/engine.mjs web/js/core/frames.mjs tests/web/core.test.mjs
git commit -m "feat(core): flagging engine and context frames ported from Python"
```

---

### Task 6: Day JSON, pipeline and the parity test (`core/day.mjs`, `core/run.mjs`)

**Files:**
- Create: `web/js/core/day.mjs`, `web/js/core/run.mjs`
- Test: `tests/web/parity.test.mjs`

- [ ] **Step 1: Write the failing parity test**

```js
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

test("every fictional day matches the Python golden file exactly", () => {
  const { days } = buildDays(fictionalFiles(), { name: "Fictional Triple-A Club", synthetic: true }, { showDays: Infinity });
  const golden = readdirSync(GOLD).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(Object.keys(days).sort(), golden.map((f) => f.replace(".json", "")));
  for (const f of golden) {
    const want = JSON.parse(readFileSync(new URL(f, GOLD), "utf8"));
    assert.deepStrictEqual(days[f.replace(".json", "")], want, f);
  }
});

test("buildDays keeps the last 14 days by default and reports the latest", () => {
  const { index } = buildDays(fictionalFiles(), { name: "X", synthetic: true });
  assert.equal(index.dates.length, 14);
  assert.equal(index.latest, index.dates.at(-1));
});
```

`deepStrictEqual` compares numbers with `Object.is`, and JSON gives `1` for Python's `1.0`, so integers and floats compare as equal values. Key order is not compared; values are.

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/parity.test.mjs`
Expected: FAIL, `run.mjs` not found.

- [ ] **Step 3: Write `web/js/core/day.mjs`**

Port `day.py` exactly:
- `CLUB = "Fictional Triple-A Club"`, `TREND_DAYS = 14`, `STATUS_WORDS`, `magnitude`, `DOMAIN_NAMES`, `driverMagnitude`.
- `domainJson(d, today, te)`:
  - `days_old` is `daysBetween(d.observed_on, today)`.
  - Rounding: `round(change, 4)`, `round(mean, 3)`, `round(sd, 3)`, `round(z, 2)`.
  - `change_te` is `null` when `!te`, else `pyRound(change / te, 1)`.
  - `beyond_mdc` is `change < -pyRound(MDC95_FACTOR * te, 4)`.
  - `swc_personal` is `pyRound(base.swc, 4)`.
- `trend`, `latest` (`pyRound(vals[0], 1)`), `beyondTeam`.
- `buildDay(readings, today, cw, log, schedule, club, sources)`: returns the same keys.
  - `cleaning_log` maps entries to `{ lc_id, day, source, rule, detail }`, filtered to `day === today`.
  - `load` is `loadContext(playerReadings, addDays(today, -1))`.
  - `reasons` is `a.reasons.length ? a.reasons : domains.flatMap((d) => d.reasons)`.
  - `te` is an object keyed `wellness_score` then `rsi_mod` (METRIC_ORDER), each a number or `null`.
  - Add `sources` only when given.

- [ ] **Step 4: Write `web/js/core/run.mjs`**

```js
// Files in, day JSON out: pipeline.py (virtual folders by row date) plus
// build_site.py's date selection. Pure function: no DOM, no storage, no network.

import { CleanLog, cleanCatapult, cleanCmj, cleanWellness } from "./clean.mjs";
import { parseCsv } from "./csv.mjs";
import { buildDay } from "./day.mjs";
import { classify, readCatapult, readCrosswalk, readSchedule, readVald, readWellness } from "./read.mjs";

const SOURCES = [["vald", readVald, cleanCmj], ["catapult", readCatapult, cleanCatapult], ["wellness", readWellness, cleanWellness]];
const NO_GAME = { opponent: "", home_away: "", note: "" };

// files: [{ name, text }]. Returns { kinds, problems } so the load screen can list them.
export function sortFiles(files) {
  const kinds = { vald: [], catapult: [], wellness: [], roster: [], schedule: [] };
  const problems = [];
  for (const f of files) {
    const table = parseCsv(f.text);
    const kind = classify(table.headers);
    if (!kind) { problems.push(`${f.name}: not a VALD, Catapult, wellness, roster or schedule file`); continue; }
    kinds[kind].push({ name: f.name, table });
  }
  if (kinds.roster.length !== 1) problems.push(kinds.roster.length ? "Drop only one roster file" : "Add the roster file (roster.csv)");
  return { kinds, problems };
}

export function buildDays(files, club, { showDays = 14 } = {}) {
  const { kinds, problems } = sortFiles(files);
  if (problems.length) throw new Error(problems.join("\n"));
  const cw = readCrosswalk(kinds.roster[0].table);
  const schedule = kinds.schedule.length ? readSchedule(kinds.schedule[0].table) : new Map();

  // Read every file, dedupe identical rows across files, then group rows by date.
  const byDay = new Map();                     // date -> { vald: [], catapult: [], wellness: [], dupes: [] }
  for (const [kind, read] of SOURCES) {
    const earlier = new Set();                 // rows from earlier files of this kind
    for (const { name, table } of kinds[kind]) {
      let rows;
      try { rows = read(table); } catch (e) { throw new Error(`${name}: ${e.message}`); }
      const here = [];
      for (const row of rows) {
        const k = JSON.stringify(row);
        if (!byDay.has(row.day)) byDay.set(row.day, { vald: [], catapult: [], wellness: [], dupes: [] });
        // Only overlap BETWEEN files is dropped. Repeats inside one file go to the
        // cleaning rules (duplicate_period, duplicate_form), exactly as in Python.
        if (earlier.has(k)) { byDay.get(row.day).dupes.push(kind); continue; }
        here.push(k);
        byDay.get(row.day)[kind].push(row);
      }
      for (const k of here) earlier.add(k);
    }
  }
  const all = [...byDay.keys()].sort();
  const withRows = all.filter((d) => SOURCES.some(([k]) => byDay.get(d)[k].length));
  const dates = withRows.slice(-showDays);
  if (!dates.length) throw new Error("No rows with dates in these files.");

  const days = {};
  for (const today of dates) {
    const log = new CleanLog();
    const readings = [];
    for (const d of all) {
      if (d > today) break;
      const dayLog = d === today ? log : new CleanLog();
      for (const [kind, , clean] of SOURCES) readings.push(...clean(byDay.get(d)[kind], cw, dayLog));
    }
    for (const kind of byDay.get(today).dupes) log.add("", today, kind, "duplicate_row", `the same ${kind} row appeared in two files; counted once`);
    days[today] = buildDay(readings, today, cw, log, schedule.get(today) ?? NO_GAME, club);
  }
  return { index: { dates, latest: dates.at(-1) }, days };
}
```

The `duplicate_row` entry happens only when files overlap, so the fictional parity data never has one.

- [ ] **Step 5: Run the parity test, then fix until it passes**

Run: `node --test tests/web/parity.test.mjs`
Expected at the end: PASS (2 tests). While it fails, the message names the date and the path of the first differing value. Fix the JS to match Python. Never edit a golden file by hand. If the cause is a Python bug, stop and report it to the reviewer.

- [ ] **Step 6: Run everything**

Run: `node --test tests/web/*.test.mjs && .venv/bin/python -m pytest -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/js/core/day.mjs web/js/core/run.mjs tests/web/parity.test.mjs
git commit -m "feat(core): day JSON and pipeline in JS, identical to Python on all 36 days"
```

---

### Task 7: Local fonts and html-to-image (no outside hosts)

**Files:**
- Create: `web/fonts/` (woff2 + `OFL.txt`), `web/css/fonts.css`, `web/vendor/html-to-image.js`, `web/vendor/LICENSE-html-to-image.txt`
- Modify: `web/css/theme.css:1`, `web/js/card.js` (`LIB` constant)
- Test: `tests/web/no-network.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// The pages may not load anything from another host: fonts and libraries ship
// in the repo. Links the user clicks (<a href>) are allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = new URL("../../web/", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f === "vendor" && dir.endsWith("board")) return [];      // anatomy kit build tooling, not loaded by pages
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const LOADS = /(@import\s+url\(|url\(\s*["']?|src\s*=\s*["']?|import\s*\(?\s*["']|fetch\(\s*["'`]|\bLIB\s*=\s*["'])https?:/i;

test("no web file loads anything from another host", () => {
  const bad = walk(WEB).filter((p) => /\.(html|css|js|mjs)$/.test(p) && !p.includes("/vendor/html-to-image"))
    .filter((p) => LOADS.test(readFileSync(p, "utf8")));
  assert.deepEqual(bad, []);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/no-network.test.mjs`
Expected: FAIL listing `web/css/theme.css` and `web/js/card.js`.

- [ ] **Step 3: Vendor the fonts (latin subset, woff2)**

Run in `~/lineup-card`:

```bash
mkdir -p web/fonts && cd web/fonts
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
curl -sA "$UA" "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Hanken+Grotesk:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" -o google.css
grep -B8 "U+0000-00FF" google.css | grep -o "https://fonts.gstatic.com/[^)]*" | sort -u
```

Expected: a short list of woff2 URLs, one per family and weight (the variable Fraunces file may cover both weights). Download each with `curl -so <family>-<weight>.woff2 <url>` using the names `fraunces.woff2`, `hanken-400.woff2`, `hanken-500.woff2`, `plex-mono-400.woff2`, `plex-mono-500.woff2` (adjust to what the list shows). Then write `web/css/fonts.css` with one `@font-face` per file:

```css
/* Fonts ship with the app (SIL Open Font License 1.1, see web/fonts/OFL.txt),
   so no page loads anything from another host. Latin subset only. */
@font-face { font-family: "Fraunces"; src: url("../fonts/fraunces.woff2") format("woff2"); font-weight: 400 500; font-display: swap; }
@font-face { font-family: "Hanken Grotesk"; src: url("../fonts/hanken-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Hanken Grotesk"; src: url("../fonts/hanken-500.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("../fonts/plex-mono-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("../fonts/plex-mono-500.woff2") format("woff2"); font-weight: 500; font-display: swap; }
```

Copy the `unicode-range` line from `google.css` into each rule. Delete `google.css`. Write `web/fonts/OFL.txt`: the SIL OFL 1.1 text (fetch from `https://openfontlicense.org/documents/OFL.txt`) with a header naming the three families and their copyright holders, as listed on each family's Google Fonts page.

- [ ] **Step 4: Point theme.css at the local fonts**

Replace line 1 of `web/css/theme.css` with:

```css
@import url("fonts.css");
```

- [ ] **Step 5: Vendor html-to-image 1.11.11**

```bash
mkdir -p web/vendor
curl -so web/vendor/html-to-image.js https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js
curl -so web/vendor/LICENSE-html-to-image.txt https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/LICENSE
head -c 300 web/vendor/html-to-image.js; echo; head -3 web/vendor/LICENSE-html-to-image.txt
```

Expected: JS source text, and "MIT License". In `web/js/card.js` change the constant to:

```js
const LIB = "vendor/html-to-image.js";   // shipped in the repo; no outside host
```

- [ ] **Step 6: Run the tests and look at the page**

Run: `node --test tests/web/*.test.mjs`
Expected: PASS.
Then serve and look: `.venv/bin/python -m http.server 8765 -d web` and open `http://localhost:8765/card.html` in the browser pane. The fonts look as before. "Save as image" downloads a PNG. In the network list, every request is to `localhost`.

- [ ] **Step 7: Commit**

```bash
git add web/fonts web/css/fonts.css web/css/theme.css web/vendor web/js/card.js tests/web/no-network.test.mjs
git commit -m "feat(web): ship fonts and html-to-image locally; no outside hosts"
```

---

### Task 8: Pages take data from a source (`source.js`, `init(src)`)

**Files:**
- Create: `web/js/source.js`
- Modify: `web/js/card.js`, `web/js/review.js`, `web/js/store.js`, `web/card.html`, `web/index.html`
- Test: append to `tests/web/logic.test.mjs` (store key)

The hosted demo must behave exactly as before. Only the plumbing changes.

- [ ] **Step 1: Write the failing store test**

```js
import { reviewKey } from "../../web/js/store.js";

test("review keys: demo key unchanged, club data scoped by club", () => {
  assert.equal(reviewKey("2026-09-20"), "lineupcard:review:2026-09-20");
  assert.equal(reviewKey("2026-09-20", "Memphis"), "lineupcard:review:Memphis:2026-09-20");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/web/logic.test.mjs`
Expected: FAIL, `reviewKey` is not exported.

- [ ] **Step 3: Update `web/js/store.js`**

Export `reviewKey(date, scope)`, which returns the old key when `scope` is empty. Give `loadReview`, `hasSavedReview` and `saveReview` an optional last argument, `scope`. Add `clearReviews(scope)`, which removes every key starting with `lineupcard:review:${scope}:` inside try/catch and returns the count. `emptyReview(reviewer = "M. Castillo")`: the offline app passes the name typed on the load screen.

- [ ] **Step 4: Write `web/js/source.js`**

```js
// Where a page gets its data. The hosted demo fetches JSON files; the offline
// edition (offline.js) builds the same shape in memory from dropped CSVs.
//   getIndex() -> { dates, latest }     getDay(date) -> day JSON
//   getExample(date) -> review | null   getBoard() -> SVG text | null
//   go(screen, date)                    scope: storage scope ("" = demo)
//   reviewer: default reviewer name

export function fetchSource() {
  const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); };
  return {
    scope: "",
    reviewer: "M. Castillo",
    getIndex: () => json("data/index.json"),
    getDay: (date) => json(`data/days/${date}.json`),
    getExample: async (date) => { const r = await fetch(`examples/review-${date}.json`); return r.ok ? r.json() : null; },
    getBoard: async () => { const r = await fetch("figures/board/board.svg"); return r.ok ? r.text() : null; },
    go: (screen, date) => { location.href = `${screen === "card" ? "card" : "index"}.html?date=${date}`; },
  };
}
```

- [ ] **Step 5: Turn `card.js` and `review.js` into `init(src)`**

In `card.js`:
- Wrap everything after the constants in `export async function init(src) { ... }`.
- Replace the three fetches with `src.getIndex()`, `src.getDay(date)` and `src.getExample(date)`. The example is used only when `!hasSavedReview(date, src.scope)` and the result is not null.
- In `drawBoard`, `const svg = await src.getBoard(); if (!svg) throw ...`.
- Add an "Export review" button to the share bar (`id="export"`). It downloads `lineup-card-review-<date>.json`, containing `{ date, club: day.club, review }`, with the same Blob + `<a download>` code the image save uses. This is the club's own record of who approved what.
- Pass `src.scope` to every store call.
- `loadLib` keeps working because `LIB` is relative. The offline bundle sets `window.htmlToImage` first, so the existing early return skips the script tag.
- The "Back to review" link gets `data-go="review"`. Inside `init`, attach `document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); src.go(a.dataset.go, date); }))`.

In `review.js`:
- Same wrap. `load(date)` uses `src.getDay`.
- The approve handler calls `src.go("card", day.date)` instead of setting `location.href`.
- `loadReview(date, src.scope)` and `saveReview(..., src.scope)`. A new review starts from `emptyReview(src.reviewer)`.
- The date list comes from `await src.getIndex()`.

In `card.html` and `index.html`, replace the module script tag with:

```html
<script type="module">
  import { init } from "./js/card.js";          // review page: ./js/review.js
  import { fetchSource } from "./js/source.js";
  init(fetchSource());
</script>
```

- [ ] **Step 6: Run the tests and check the hosted demo by hand**

Run: `node --test tests/web/*.test.mjs && .venv/bin/python -m pytest -q`
Expected: all pass.
Serve `web/` on port 8765. In the browser pane:
1. `card.html` shows the 2026-09-20 example: 1 Check in, 1 Watch, 25 No change, 1 Not enough data, 28 board pegs.
2. "Back to review" opens the review page.
3. Approving a review returns to the card.
4. The console has no errors.

- [ ] **Step 7: Commit**

```bash
git add web/js/source.js web/js/card.js web/js/review.js web/js/store.js web/card.html web/index.html tests/web/logic.test.mjs
git commit -m "refactor(web): pages read data through a source object"
```

---

### Task 9: The offline app (`offline.html`, `offline.js`)

**Files:**
- Create: `web/offline.html`, `web/js/offline.js`, `web/css/offline.css`
- Modify: `scripts/build_offline.py` (created in Task 10; for now the dev page loads the sample through `web/js/sample-data.js`, generated by Step 1)

One page, three screens. Only one screen is in the DOM at a time, so the IDs the review and card scripts use never clash. The screen markup lives in `<template>` tags copied from the bodies of `index.html` and `card.html`.

- [ ] **Step 1: Generate the dev sample module**

Create `scripts/write_sample_module.py`. It writes `web/js/sample-data.js` as `export const SAMPLE = [{ name, text }, ...]`, containing `crosswalk.csv` renamed `roster.csv`, `schedule.csv`, and every inbox CSV named `<date>/<file>`. Also `export const SAMPLE_CLUB = { name: "Fictional Triple-A Club", synthetic: true }` and `export const SAMPLE_EXAMPLE = <web/examples/review-2026-09-20.json>`. Add `web/js/sample-data.js` to `.gitignore`, since it is generated. Run it.

- [ ] **Step 2: Write `web/offline.html`**

The page has:
- `<head>`: `theme.css`, `card.css`, `offline.css`. No CSP here: it would block `js/offline.js` on the dev server. The build adds it (Task 10).
- `<div id="app"></div>`.
- `<template id="tpl-review" data-from="index.html"></template>` and `<template id="tpl-card" data-from="card.html"></template>`, both empty. The build fills them with the `<body>` of those pages minus their scripts, so the markup is never copied by hand. In dev, `offline.js` fills empty templates by fetching the page (see Step 3).
- `<template id="tpl-load">`: the load screen:
  - an `h1` "Lineup Card";
  - a one-line promise: "Runs on this computer. Nothing is uploaded.";
  - inputs `#club` (club name), `#reviewer` (your name), both required;
  - a drop zone `#drop` with a hidden `<input type="file" id="files" multiple accept=".csv">` and the text "Drop the VALD, Catapult and wellness exports and roster.csv here, or click to choose";
  - `#found`, a list of the recognized files with their kind;
  - `#problems` (`role="alert"`);
  - buttons `#go` "Build today's review" and `#sample` "Try it with the fictional sample";
  - a small `#forget` button "Forget saved reviews on this computer";
  - a footer: "Built by Mauro Castillo as a portfolio example. Not a club product. A coaching aid, not a diagnosis or injury predictor. No AI inside."
- `<script type="module" src="js/offline.js"></script>` (inlined by the build).

- [ ] **Step 3: Write `web/js/offline.js`**

```js
// Offline edition: CSVs in, review and card out, all in this browser tab.
// Dropped files are kept in memory only; saved reviews use localStorage,
// scoped by club name, and "Forget" clears them.

import { buildDays, sortFiles } from "./core/run.mjs";
import { init as initCard } from "./card.js";
import { init as initReview } from "./review.js";
import { clearReviews } from "./store.js";
import { SAMPLE, SAMPLE_CLUB, SAMPLE_EXAMPLE } from "./sample-data.js";

const app = document.getElementById("app");
let built = null;      // { index, days, club, synthetic }

// Dev only: the build fills these templates; served unbundled, fetch the page bodies.
async function fillTemplates() {
  for (const tpl of document.querySelectorAll("template[data-from]")) {
    if (tpl.content.childNodes.length) continue;
    const html = await (await fetch(tpl.dataset.from)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    tpl.innerHTML = doc.body.innerHTML;
  }
}

function show(id, reviewer) {
  app.replaceChildren(document.getElementById(id).content.cloneNode(true));
  if (id !== "tpl-load") {
    const again = Object.assign(document.createElement("button"), { className: "noprint start-over", textContent: "Start over" });
    again.addEventListener("click", () => showLoad());
    app.prepend(again);
  }
  window.scrollTo(0, 0);
}

function source(reviewer) {
  return {
    scope: built.club,
    reviewer,
    getIndex: async () => built.index,
    getDay: async (date) => built.days[date],
    getExample: async (date) => (built.synthetic && SAMPLE_EXAMPLE.date === date ? SAMPLE_EXAMPLE : null),
    getBoard: async () => (built.synthetic ? document.getElementById("board-svg")?.textContent ?? null : null),
    go: (screen, date) => route(screen, date, reviewer),
  };
}

function route(screen, date, reviewer) {
  if (screen === "load") return showLoad();
  history.replaceState(null, "", `#${screen}${date ? `:${date}` : ""}`);
  show(screen === "card" ? "tpl-card" : "tpl-review");
  const src = source(reviewer);
  const at = date ? { ...src, getIndex: async () => ({ ...built.index, latest: date }) } : src;
  return screen === "card" ? initCard(at) : initReview(at);
}

function showLoad() {
  show("tpl-load");
  history.replaceState(null, "", "#load");
  const $ = (id) => document.getElementById(id);
  let files = [];
  const say = (lines) => { $("problems").textContent = lines.join("\n"); };
  const list = () => {
    const { kinds, problems } = sortFiles(files);
    $("found").innerHTML = "";
    for (const [kind, items] of Object.entries(kinds)) {
      for (const f of items) $("found").insertAdjacentHTML("beforeend", `<li><b>${kind}</b> ${f.name.replace(/[&<>"]/g, "")}</li>`);
    }
    say(problems);
  };
  const take = async (fileList) => {
    for (const f of fileList) files.push({ name: f.name, text: await f.text() });
    list();
  };
  $("files").addEventListener("change", (e) => take(e.target.files));
  $("drop").addEventListener("click", () => $("files").click());
  $("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
  $("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
  $("drop").addEventListener("drop", (e) => { e.preventDefault(); $("drop").classList.remove("over"); take(e.dataTransfer.files); });
  const start = (theFiles, club) => {
    const reviewer = $("reviewer").value.trim();
    if (!club.name || !reviewer) return say(["Type the club name and your name first."]);
    try {
      built = { ...buildDays(theFiles, club), club: club.name, synthetic: club.synthetic };
    } catch (e) {
      return say(String(e.message).split("\n"));
    }
    route("review", built.index.latest, reviewer);
  };
  $("go").addEventListener("click", () => start(files, { name: $("club").value.trim(), synthetic: false }));
  $("sample").addEventListener("click", () => { $("club").value ||= SAMPLE_CLUB.name; start(SAMPLE, SAMPLE_CLUB); });
  $("forget").addEventListener("click", () => {
    const club = $("club").value.trim();
    if (!club) return say(["Type the club name whose saved reviews you want to forget."]);
    say([`Forgot ${clearReviews(club)} saved review(s) for ${club} on this computer.`]);
  });
}

await fillTemplates();
showLoad();
```

The board SVG is inlined by the build as `<script type="image/svg+xml" id="board-svg">`. In dev, `getBoard` returns null and the card says "Board figure not built yet". That is acceptable for dev; the bundle has the board.

- [ ] **Step 4: Write `web/css/offline.css`**

Load screen only. Use the theme tokens (`var(--ink)`, `var(--bg)`, the accent token already in theme.css) and the site's radius scale.
- The drop zone is a dashed 2px border, 12px radius, min-height 160px, with a `.over` state.
- `#problems` uses `--st-check` with an icon-free text label "Fix first:" in front.
- The layout works at phone width: inputs stack below 640px.
- Keep it under 80 lines.

- [ ] **Step 5: Check it in the browser (served, before bundling)**

Serve `web/` on port 8765, open `http://localhost:8765/offline.html` in the browser pane, and check:
1. "Try it with the fictional sample" opens the review for 2026-09-20 with the same flags as the hosted demo.
2. Approve opens the card. The card is the same as the hosted demo.
3. "Start over", then drop the real fictional files from `data/fictional/inbox/2026-09-1*/*` plus `crosswalk.csv`. The found list shows the kinds.
4. Drop a random non-CSV file. The problems box names it.
5. No console errors.

- [ ] **Step 6: Run the tests and commit**

Run: `node --test tests/web/*.test.mjs && .venv/bin/python -m pytest -q`
Expected: all pass.

```bash
git add web/offline.html web/js/offline.js web/css/offline.css scripts/write_sample_module.py .gitignore web/js/card.js web/js/review.js web/index.html web/card.html
git commit -m "feat(offline): load screen and in-memory source for the offline edition"
```

---

### Task 10: Bundle into one file (`scripts/build_offline.py`)

**Files:**
- Create: `scripts/build_offline.py`, `tests/test_build_offline.py`, `tests/test_offline_smoke.py`
- Modify: `.gitignore` (add `dist/`)

The bundler is ours and handles only our own code style. Each module becomes a function that returns its exports, registered by path and evaluated in dependency order. The test proves no import or export statement is left over.

- [ ] **Step 1: Write the failing tests**

`tests/test_build_offline.py`:

```python
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "lineup-card.html"


def build() -> str:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    return OUT.read_text(encoding="utf-8")


def test_one_file_with_a_csp_that_blocks_the_network():
    html = build()
    csp = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    assert csp, "CSP meta missing"
    policy = csp.group(1)
    assert "default-src 'none'" in policy
    assert "connect-src data:" in policy
    assert "http" not in policy


def test_nothing_is_loaded_from_anywhere():
    html = build()
    html = re.sub(r'<script id="vendor-html-to-image">.*?</script>', "", html, flags=re.S)   # third-party source text
    assert not re.search(r'<(script|link|img|iframe)[^>]+(src|href)=', html), "external tag"
    assert not re.search(r'url\(\s*["\']?(?!data:|#)', html), "url() that is not data: or #id"
    assert not re.search(r'^\s*(import|export)\s', html, re.M), "unbundled module syntax"
    assert "fonts.googleapis" not in html and "jsdelivr" not in html


def test_contains_the_app_the_sample_and_the_board():
    html = build()
    for marker in ('id="tpl-load"', 'id="tpl-review"', 'id="tpl-card"', 'id="board-svg"', "Fictional Triple-A Club", "buildDays"):
        assert marker in html, marker
    assert len(html) < 3_000_000
```

`tests/test_offline_smoke.py` runs headless Chrome on the built file. It is skipped when Chrome is missing.

```python
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


@pytest.mark.skipif(not Path(CHROME).exists(), reason="Chrome not installed")
def test_sample_builds_a_review_in_the_offline_file():
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    url = (ROOT / "dist" / "lineup-card.html").as_uri() + "#autosample"
    dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=8000",
                          "--dump-dom", url], capture_output=True, text=True, timeout=60).stdout
    assert "Approve" in dom or "approve" in dom, dom[:500]
    assert "J. Ortega" in dom
```

`#autosample` is a test-only hash. In `offline.js`, after `showLoad()`, add: `if (location.hash === "#autosample") { document.getElementById("reviewer").value = "Test"; document.getElementById("sample").click(); }`.

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_build_offline.py tests/test_offline_smoke.py -q`
Expected: FAIL, the build script does not exist.

- [ ] **Step 3: Write `scripts/build_offline.py`**

```python
"""Bundle the offline edition into one file: dist/lineup-card.html.

Every script, stylesheet, font, the board figure, html-to-image and the
fictional sample go inside the file. A Content-Security-Policy stops the
browser from loading or sending anything over the network.

Run: .venv/bin/python scripts/build_offline.py
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "dist" / "lineup-card.html"
ENTRY = "js/offline.js"

CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
       "font-src data:; img-src data: blob:; connect-src data:; base-uri 'none'; form-action 'none'")

IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"(\./[^"]+|\.\./[^"]+)";?\s*$', re.M)
EXPORT_DECL = re.compile(r'^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)', re.M)


def module_path(base: Path, spec: str) -> Path:
    return (base.parent / spec).resolve()


def bundle(entry: Path) -> str:
    order: list[Path] = []
    seen: set[Path] = set()

    def visit(path: Path) -> None:
        if path in seen:
            return
        seen.add(path)
        for _, spec in IMPORT.findall(path.read_text(encoding="utf-8")):
            visit(module_path(path, spec))
        order.append(path)

    visit(entry.resolve())
    parts = ["const __m = {};"]
    for path in order:
        src = path.read_text(encoding="utf-8")
        key = path.relative_to(WEB).as_posix()

        def imp(m: re.Match) -> str:
            dep = module_path(path, m.group(2)).relative_to(WEB).as_posix()
            names = ", ".join(n.strip().replace(" as ", ": ") for n in m.group(1).split(",") if n.strip())
            return f'const {{ {names} }} = __m["{dep}"];'

        body = IMPORT.sub(imp, src)
        names = EXPORT_DECL.findall(body)
        body = EXPORT_DECL.sub(lambda m: f"{m.group(1)} {m.group(2)}", body)
        if re.search(r"^\s*(import|export)\b", body, re.M):
            raise SystemExit(f"{key}: unsupported import/export form; use 'import {{ a }} from \"./x.js\"' and 'export function/const'")
        exports = ", ".join(n for _, n in names)
        parts.append(f'__m["{key}"] = await (async () => {{\n{body}\nreturn {{ {exports} }};\n}})();')
    return "\n".join(parts)


def css(path: Path) -> str:
    text = path.read_text(encoding="utf-8")

    def inline_import(m: re.Match) -> str:
        return css(path.parent / m.group(1))

    text = re.sub(r'@import\s+url\("([^"]+)"\);', inline_import, text)

    def font(m: re.Match) -> str:
        data = base64.b64encode((path.parent / m.group(1)).read_bytes()).decode()
        return f'url("data:font/woff2;base64,{data}")'

    return re.sub(r'url\("(\.\./fonts/[^"]+\.woff2)"\)', font, text)


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "write_sample_module.py")], check=True)
    page = (WEB / "offline.html").read_text(encoding="utf-8")
    styles = "\n".join(css(WEB / "css" / n) for n in ("theme.css", "card.css", "offline.css"))
    page = re.sub(r'\s*<link rel="stylesheet" href="[^"]+">', "", page)
    page = page.replace("</head>", f"<style>\n{styles}\n</style>\n</head>")
    lib = (WEB / "vendor" / "html-to-image.js").read_text(encoding="utf-8")
    board = (WEB / "figures" / "board" / "board.svg").read_text(encoding="utf-8")
    app = bundle(WEB / ENTRY)
    scripts = (f'<script type="image/svg+xml" id="board-svg">{board}</script>\n'
               f'<script id="vendor-html-to-image">\n{lib}\n</script>\n'
               f'<script type="module">\n{app}\n</script>')
    page = re.sub(r'<script type="module" src="js/offline.js"></script>', lambda _: scripts, page)
    page = page.replace("<head>", f'<head>\n<meta http-equiv="Content-Security-Policy" content="{CSP}">', 1)
    for tpl, src in (("tpl-review", "index.html"), ("tpl-card", "card.html")):
        body = re.search(r"<body>(.*)</body>", (WEB / src).read_text(encoding="utf-8"), re.S).group(1)
        body = re.sub(r"<script.*?</script>", "", body, flags=re.S)
        page = page.replace(f'<template id="{tpl}" data-from="{src}"></template>', f'<template id="{tpl}">{body}</template>')
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
```

Inline `<script>` blocks may not contain `</script`. Add a check that raises when `lib`, `board` or `app` contains `</script` (case-insensitive).

Add `dist/` to `.gitignore`.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_build_offline.py tests/test_offline_smoke.py -q`
Expected: PASS (4 tests). If the smoke test fails, open the file in the browser pane and read the console.

- [ ] **Step 5: Check the real file by hand**

Open `file:///Users/maurocastillo/lineup-card/dist/lineup-card.html` in the browser pane and check:
1. Try the sample. Review, approve, card.
2. Print preview fits one Letter page.
3. Save as image downloads a PNG.
4. Copy for group text works.
5. `read_network_requests` lists only `file://` and `data:` entries.
6. The console has no CSP violations.

Do the same at phone width (375).

- [ ] **Step 6: Commit**

```bash
git add scripts/build_offline.py tests/test_build_offline.py tests/test_offline_smoke.py web/offline.html web/js/offline.js .gitignore
git commit -m "feat(offline): bundle the edition into one file behind a no-network CSP"
```

---

### Task 11: Prompt pack, how-to, IT fact sheet and the share package

**Files:**
- Create: `docs/club-edition/COPILOT-CHATGPT-PROMPTS.md`, `docs/club-edition/how-to-use.html`, `docs/club-edition/it-fact-sheet.html`, `scripts/package_club_edition.py`, `tests/test_package.py`
- Modify: `README.md` (new section "Club Edition (offline)")

Writing rules for every document: plain language, grade 7 to 8, no em dashes, short sentences. No club logos or marks. Never claim the tool meets any club's IT policy; state checkable facts only.

- [ ] **Step 1: Write the failing package test**

```python
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "dist" / "club-edition"


def test_package_has_everything_and_no_real_data():
    subprocess.run([sys.executable, str(ROOT / "scripts" / "package_club_edition.py")], check=True, cwd=ROOT)
    names = {p.relative_to(PKG).as_posix() for p in PKG.rglob("*") if p.is_file()}
    for need in ("lineup-card.html", "HOW-TO-USE.pdf", "IT-FACT-SHEET.pdf", "COPILOT-CHATGPT-PROMPTS.md",
                 "sample-data/roster.csv", "sample-data/schedule.csv"):
        assert need in names, need
    assert any(n.startswith("sample-data/") and n.endswith("vald_forcedecks_cmj.csv") for n in names)
    assert not any("live" in n for n in names)
    for doc in ("COPILOT-CHATGPT-PROMPTS.md",):
        assert "—" not in (PKG / doc).read_text(), "no em dashes"
```

- [ ] **Step 2: Run to see it fail**

Run: `.venv/bin/python -m pytest tests/test_package.py -q`
Expected: FAIL.

- [ ] **Step 3: Write `docs/club-edition/COPILOT-CHATGPT-PROMPTS.md`**

Sections:
1. **Before you paste anything.** Use only the Copilot or ChatGPT your club has approved, signed in with your club account. Follow your club's rules on player data. If unsure, replace names with initials first. The AI never decides who is flagged; the card already did that with fixed math you approved.
2. **Staff note from today's card.** Paste the text from "Copy for group text". The prompt: write a 4-to-6-line note for the manager and staff, plain words, keep every status word exactly ("Check in", "Watch", "No change", "Not enough data"), add no numbers or advice the card does not contain, end with "Reviewed by <name>".
3. **Explain one flag to a coach.** Paste one player's line from the card. The prompt: explain in 3 sentences what changed versus his normal and what "Check in" means (talk with him before he trains). No diagnosis, no injury language.
4. **Weekly look-back.** Paste 5 to 7 daily summaries. The prompt: list players flagged on 2 or more days, and days when the whole team was down. No predictions.
5. **What not to ask it.** Do not ask whether a player is injured, should play, or will get hurt. Do not paste raw vendor exports.

Each prompt sits in a fenced `text` block, so it copies cleanly.

- [ ] **Step 4: Write `how-to-use.html` and `it-fact-sheet.html`**

Both are one Letter page each, styled with `web/css/theme.css` tokens (inline the CSS the same way the build does, or link `../../web/css/theme.css`; the package script prints them with headless Chrome).

`how-to-use.html`: pictures first. Five numbered steps, each with a screenshot (Step 5 below makes them):
1. Open the file.
2. Type club and your name, then drop the files.
3. Mark today's lineup.
4. Decide each flag and approve.
5. Print, save the image, or copy for group text.

Below the steps: "What the words mean" (the four statuses with their glyphs), and "What it needs": files with these headers, at least 10 readings per player over 28 days before a player can be flagged.

`it-fact-sheet.html`, as facts IT can check:
- **What it is:** one HTML file, about N KB (the real size), opened from disk in Edge or Chrome. No install, no admin rights, no account.
- **Network:** the file carries a Content-Security-Policy (quote it). The browser refuses every network request. How to check: open DevTools, Network tab; nothing is listed.
- **Data:** CSVs are read in browser memory. Reviews (player IDs, decisions, notes) are saved in that browser's local storage under the club name. "Forget saved reviews" deletes them, and so does clearing the browser's site data. Nothing is uploaded.
- **AI:** none inside. An optional prompt guide suggests using the club's approved Copilot or ChatGPT on the approved summary.
- **Code:** open source at github.com/maurocastillomd/lineup-card. List the third-party pieces with licenses: html-to-image (MIT), the Fraunces, Hanken Grotesk and IBM Plex Mono fonts (SIL OFL 1.1), the anatomy kit (MIT).
- **Limits:** a coaching aid, not a diagnosis or injury predictor. Not a club product; built by Mauro Castillo as a portfolio example.

- [ ] **Step 5: Make the screenshots**

With the browser pane on the built file (sample data), take one screenshot per step at 1280 wide. Save them as `docs/club-edition/shots/step-1.png` to `step-5.png`. Crop to the relevant area with the `zoom` action, or keep full frames. Keep each under 300 KB (resize with `sips -Z 1200`).

- [ ] **Step 6: Write `scripts/package_club_edition.py`**

It:
1. Runs `build_offline.py`.
2. Makes `dist/club-edition/` fresh. It removes only that folder, and only after checking the path ends in `dist/club-edition`.
3. Copies `dist/lineup-card.html`.
4. Copies `data/fictional/crosswalk.csv` to `sample-data/roster.csv`, plus `schedule.csv`, and every inbox folder to `sample-data/<date>/`.
5. Copies the prompt pack.
6. Prints the two HTML docs to PDF with `"<Chrome>" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=<out> <file-uri>`.
7. Prints the folder listing with sizes.

- [ ] **Step 7: Run the tests, then check the PDFs**

Run: `.venv/bin/python -m pytest -q && node --test tests/web/*.test.mjs`
Expected: all pass.
Open both PDFs: each is exactly one page and readable. Then rasterize page 1 of each to JPEG for Mauro (standing rule: share a JPEG of every figure) with `sips -s format jpeg dist/club-edition/HOW-TO-USE.pdf --out docs/club-edition/how-to-use.jpg` (and the same for the fact sheet).

- [ ] **Step 8: README section**

Add "Club Edition (offline)" after "Real data":
- what it is (3 lines);
- how to build it (`.venv/bin/python scripts/package_club_edition.py`);
- what is in the package;
- the three documented differences from the Python edition;
- "Not tested inside any club's network or with a club's real exports yet."

- [ ] **Step 9: Commit**

```bash
git add docs/club-edition scripts/package_club_edition.py tests/test_package.py README.md
git commit -m "docs(club-edition): prompt pack, how-to, IT fact sheet and package script"
```

---

### Task 12: Final verification and state

- [ ] **Step 1: Full test run from clean**

Run: `.venv/bin/python scripts/write_parity_golden.py && git status --short && .venv/bin/python -m pytest -q && node --test tests/web/*.test.mjs`
Expected: the golden files are unchanged (no diff); every test passes. Report the exact counts.

- [ ] **Step 2: Hosted demo unchanged**

Run `.venv/bin/python scripts/build_site.py` and `git status --short web/data`.
Expected: no changes, so the demo data is byte-identical.

- [ ] **Step 3: Independent review**

Dispatch a code reviewer over `git diff main...club-edition`. Focus areas:
- parity gaps the fictional data cannot reveal;
- XSS in the load screen (file names, cell values reaching innerHTML);
- CSP holes;
- the bundler's regex assumptions;
- storage scoping.

Fix confirmed findings with tests.

- [ ] **Step 4: Update `~/claude-projects/mauro-context/CURRENT_STATE.md`**

Under Lineup Card, record the branch, commits and test counts. Status words: implemented, tested; not pushed, not sent. Then list:
- Next: Mauro reviews the package.
- Push only with his OK.
- Sending to Ross, Campbell Quirk and Julian Rip is Mauro's step.

- [ ] **Step 5: Show Mauro**

Send `dist/club-edition/lineup-card.html`, the two JPEGs and the prompt pack with SendUserFile.

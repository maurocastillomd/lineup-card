# Lineup Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Lineup Card: a pipeline that collects fictional VALD, Catapult and wellness exports, cleans and flags them against each player's own baseline, pauses for the coach's review, and renders a one-page staff report in the maurocastillomd.com theme.

**Architecture:** A Python package (`lineup_card`) does every calculation and writes one JSON file per day. A static web app (vanilla HTML/CSS/JS, no build step) reads those files, runs the review step in the browser, and renders the Lineup Card, which prints to one US Letter page. The status engine is copied from Readiness commit `09435aa` and extended with a noise gate.

**Tech Stack:** Python 3.13, pydantic 2, pytest; vanilla JS with `node --test` for pure logic; anatomy kit (`iso-kit.mjs`, MIT) for the availability board; headless Chrome for the print check.

**Spec:** `docs/superpowers/specs/2026-10-21-lineup-card-design.md`

**Ground rules for every task**
- Work in `~/lineup-card`. Never edit `~/readiness`.
- Every file and page says the roster is fictional and the card is not a fitness-to-play decision.
- Commit after each task. Never push. Publishing needs Mauro's OK.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

```
lineup-card/
  pyproject.toml
  .gitignore
  src/lineup_card/
    __init__.py
    models.py            Reading, metric specs, assessments (from Readiness, trimmed)
    engine.py            baselines, z, two-gate status, convergence, load context
    adapters/
      __init__.py
      headers.py         "Name [unit]" header parsing, known units
      vald.py            ForceDecks CSV -> CmjTrial rows
      catapult.py        OpenField CSV -> CatapultPeriod rows, local session date
      wellness.py        wellness CSV -> WellnessRow rows
      api_stub.py        interface a real vendor API client would fill
    crosswalk.py         player identity across sources
    clean.py             cleaning rules -> Reading list + CleanLog
    frames.py            typical error, position medians, team shift, league ref
    day.py               one day's JSON for the web app
    pipeline.py          read inbox folders up to a date, run everything
  scripts/
    generate_fictional.py
    build_site.py
  data/fictional/        roster.csv, crosswalk.csv, schedule.csv, inbox/DATE/*.csv
  web/
    index.html           review screen
    card.html            the Lineup Card
    css/theme.css        site tokens
    css/card.css         card + print layout
    js/logic.js          pure functions (tested with node --test)
    js/store.js          localStorage wrapper
    js/review.js         review screen
    js/card.js           card rendering
    data/                written by build_site.py
    figures/board/       build.mjs, board.svg, vendor/iso-kit.mjs
  tests/                 pytest files + web/*.test.mjs
  README.md
```

---

### Task 1: Scaffold the project and copy the engine

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/lineup_card/__init__.py`, `tests/conftest.py`
- Create (copied): `src/lineup_card/models.py`, `src/lineup_card/engine.py`
- Test: `tests/test_scaffold.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "lineup-card"
version = "0.1.0"
description = "Daily staff report from force plate, GPS and wellness data. Fictional roster. Not a fitness-to-play decision."
requires-python = ">=3.11"
dependencies = ["pydantic>=2.0"]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create `.gitignore`**

```
.venv/
__pycache__/
*.egg-info/
.pytest_cache/
web/figures/board/shots/
```

- [ ] **Step 3: Create `tests/conftest.py`**

```python
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))
```

- [ ] **Step 4: Copy the engine from the Readiness commit (not the working tree)**

```bash
cd ~/lineup-card
mkdir -p src/lineup_card/adapters tests/web
git -C ~/readiness show 09435aa:src/readiness/models.py > src/lineup_card/models.py
git -C ~/readiness show 09435aa:src/readiness/engine.py > src/lineup_card/engine.py
printf '"""Lineup Card. Built on the Readiness engine (09435aa)."""\n' > src/lineup_card/__init__.py
printf '' > src/lineup_card/adapters/__init__.py
```

- [ ] **Step 5: Write the failing scaffold test**

`tests/test_scaffold.py`:
```python
def test_engine_imports():
    from lineup_card import engine, models
    assert engine.BASELINE_DAYS == 28
    assert models.Status.REVIEW.value == "review"
```

- [ ] **Step 6: Create the venv and run the test**

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -q -e '.[dev]'
.venv/bin/python -m pytest tests/test_scaffold.py -q
```
Expected: `1 passed`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Lineup Card and copy Readiness engine (09435aa)"
```

---

### Task 2: Trim the models to Lineup Card's metrics

Two response domains (wellness, RSI-mod). HRV and sRPE/GPS-distance go. Context metrics become jump height, PlayerLoad, throws and pitches.

**Files:**
- Modify: `src/lineup_card/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_models.py`:
```python
from datetime import date

import pytest

from lineup_card.models import (CONTEXT_METRICS, METRICS, Domain, DomainAssessment,
                                LoadContext, Reading, Status)


def test_two_response_domains():
    assert set(METRICS) == {Domain.PERCEPTUAL, Domain.NEUROMUSCULAR}
    assert METRICS[Domain.NEUROMUSCULAR].column == "rsi_mod"
    assert METRICS[Domain.PERCEPTUAL].column == "wellness_score"


def test_context_metrics():
    assert CONTEXT_METRICS == {"jump_height_cm", "player_load", "throw_count", "pitch_count"}


def test_reading_accepts_context_metric_and_rejects_unknown():
    Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
            metric="throw_count", value=40, source="catapult")
    with pytest.raises(ValueError):
        Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
                metric="hrv_lnrmssd", value=4.0)


def test_reading_rejects_negative():
    with pytest.raises(ValueError):
        Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
                metric="rsi_mod", value=-0.1)


def test_domain_assessment_has_noise_fields():
    d = DomainAssessment(domain=Domain.NEUROMUSCULAR, status=Status.CLEARED, fresh=True,
                         today=0.5, base=None, pct=None, decline_z=None)
    assert d.beyond_noise is None and d.te is None


def test_load_context_fields():
    lc = LoadContext()
    assert lc.throws_7d is None and lc.player_load_today is None
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_models.py -q`
Expected: FAIL (ImportError on `CONTEXT_METRICS`).

- [ ] **Step 3: Edit `src/lineup_card/models.py`**

Replace the module docstring's first line with `"""Data models for Lineup Card (from Readiness 09435aa, trimmed).` and keep the rest of the docstring.

Replace the `Domain` and `ReadinessDriver` enums with:
```python
class Domain(str, Enum):
    PERCEPTUAL = "perceptual"        # wellness questionnaire
    NEUROMUSCULAR = "neuromuscular"  # CMJ RSI-mod


class ReadinessDriver(str, Enum):
    PERCEPTUAL = "perceptual"
    NEUROMUSCULAR = "neuromuscular"
```

Replace `METRICS` and the three context constants (`SRPE`, `HSR`, `TOTAL`) with:
```python
METRICS: dict[Domain, MetricSpec] = {
    Domain.PERCEPTUAL: MetricSpec(
        domain=Domain.PERCEPTUAL, column="wellness_score",
        label="Wellness", unit="pts", higher_is_worse=False, rolling_days=1),
    Domain.NEUROMUSCULAR: MetricSpec(
        domain=Domain.NEUROMUSCULAR, column="rsi_mod",
        label="RSI-mod", unit="m/s", higher_is_worse=False, rolling_days=1),
}

# context metrics: shown on the card, never set a status
JUMP_HEIGHT = "jump_height_cm"
PLAYER_LOAD = "player_load"
THROWS = "throw_count"
PITCHES = "pitch_count"
CONTEXT_METRICS = {JUMP_HEIGHT, PLAYER_LOAD, THROWS, PITCHES}
```

In `Reading.known_metric`, change the allowed set to:
```python
        if value not in {s.column for s in METRICS.values()} | CONTEXT_METRICS:
```

In `Reading.nonnegative_metrics`, change the condition to `if self.value < 0:`.

In `DomainAssessment`, add after `consecutive_declines`:
```python
    te: float | None = None              # typical error, raw units
    beyond_noise: bool | None = None     # None when TE unknown
```

Replace `LoadContext` with:
```python
class LoadContext(BaseModel):
    """Workload CONTEXT from Catapult. Never sets a status."""

    player_load_today: float | None = None
    throws_today: int | None = None
    pitches_today: int | None = None
    throws_7d: int | None = None        # throws + pitches, last 7 days, None if no rows
```

Delete the classes `Flag`, `Brief`, `DailyPoint`, `AthleteWeek`, `WeeklyReport` (Lineup Card does not use them).

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_models.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(models): two response domains, baseball context metrics, noise fields"
```

---

### Task 3: Engine noise gate and new load context

**Files:**
- Modify: `src/lineup_card/engine.py`
- Test: `tests/test_engine.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_engine.py`:
```python
from datetime import date, timedelta

from lineup_card.engine import (MIN_BASELINE_SESSIONS, assess_athlete, assess_domain,
                                compute_baseline, count_consecutive_declines,
                                load_context, z_score)
from lineup_card.models import METRICS, Domain, Reading, Status

RSI = METRICS[Domain.NEUROMUSCULAR]
D0 = date(2026, 9, 1)


def series(values, start=D0):
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


def test_helpers_still_work():
    assert compute_baseline([1.0] * (MIN_BASELINE_SESSIONS - 1)) is None
    base = compute_baseline([1.0 + (0.1 if i % 2 else -0.1) for i in range(12)])
    assert round(z_score(0.8, base), 2) == round((0.8 - base.mean) / base.sd, 2)
    assert count_consecutive_declines([5, 4, 3, 2]) == 3


def test_large_drop_beyond_noise_is_review():
    pts = series([0.55, 0.57] * 10 + [0.45])
    d = assess_domain(RSI, pts, pts[-1][0], te=0.02)
    assert d.status is Status.REVIEW and d.beyond_noise is True and d.te == 0.02


def test_large_z_inside_noise_is_cleared():
    # very steady athlete: tiny SD, so a small drop has a big z
    pts = series([0.550, 0.552] * 10 + [0.540])
    d = assess_domain(RSI, pts, pts[-1][0], te=0.03)
    assert d.decline_z <= -2.0
    assert d.status is Status.CLEARED and d.beyond_noise is False
    assert any("inside test noise" in r for r in d.reasons)


def test_unknown_te_does_not_block_flag():
    pts = series([0.55, 0.57] * 10 + [0.45])
    d = assess_domain(RSI, pts, pts[-1][0], te=None)
    assert d.status is Status.REVIEW and d.beyond_noise is None
    assert any("noise not yet estimated" in r for r in d.reasons)


def _readings(rsi, well, start=D0):
    out = []
    for i, (r, w) in enumerate(zip(rsi, well)):
        day = start + timedelta(days=i)
        out.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                           metric="rsi_mod", value=r))
        out.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                           metric="wellness_score", value=w))
    return out


def test_convergence_ignores_domain_inside_noise():
    rsi = [0.550, 0.552] * 10 + [0.541]       # z very low but inside TE
    well = [20, 22] * 10 + [19]               # z about -1.9, beyond TE 0.5
    a = assess_athlete(_readings(rsi, well), D0 + timedelta(days=20),
                       te={"rsi_mod": 0.03, "wellness_score": 0.5})
    assert a.status is Status.MONITOR


def test_convergence_counts_both_when_beyond_noise():
    # each domain alone is only Watch (z about -1.4 and -1.9); together they converge
    rsi = [0.55, 0.57] * 10 + [0.546]
    well = [20, 22] * 10 + [19]
    a = assess_athlete(_readings(rsi, well), D0 + timedelta(days=20),
                       te={"rsi_mod": 0.005, "wellness_score": 0.5})
    assert a.status is Status.REVIEW


def test_load_context_sums_last_seven_days():
    rows = []
    for i in range(10):
        day = D0 + timedelta(days=i)
        rows.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=day,
                            metric="throw_count", value=10))
    rows.append(Reading(athlete_id="LC01", name="J. Doe", pos="RP", day=D0 + timedelta(days=9),
                        metric="pitch_count", value=25))
    lc = load_context(rows, D0 + timedelta(days=9))
    assert lc.throws_today == 10 and lc.pitches_today == 25
    assert lc.throws_7d == 7 * 10 + 25


def test_load_context_missing_is_none_not_zero():
    lc = load_context([], D0)
    assert lc.throws_7d is None and lc.player_load_today is None
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_engine.py -q`
Expected: FAIL (`assess_domain() got an unexpected keyword argument 'te'`).

- [ ] **Step 3: Edit `src/lineup_card/engine.py`**

Change the import line to:
```python
from .models import (METRICS, PITCHES, PLAYER_LOAD, THROWS, AthleteAssessment,
                     Baseline, Domain, DomainAssessment, LoadContext, MetricSpec,
                     ReadinessDriver, Reading, Status)
```

Delete the constants `ACUTE_DAYS` and `LOAD_SPIKE_Z`. Add `LOAD_DAYS = 7`.

Add to the module docstring, after the `Convergence` paragraph:
```
  Noise gate   A flag also needs the drop from baseline to exceed the
               metric's typical error (TE, Hopkins 2000), estimated from
               the squad's own repeat readings. A big z inside TE is
               "No change". Unknown TE never blocks a flag; the reason
               says the noise is not yet estimated.
```
Replace the `Context` paragraph with:
```
  Context      Jump height, PlayerLoad, throws and pitches come along as
               CONTEXT. They never set a status.
```

Change the signature of `assess_domain` to:
```python
def assess_domain(spec: MetricSpec, points: list[tuple[date, float]],
                  today: date, te: float | None = None) -> DomainAssessment:
```

In `assess_domain`, replace everything from `reasons: list[str] = []` down to the final `return` with:
```python
    drop = base.mean - g_today          # goodness units; positive means worse
    beyond_noise = None if te is None else drop > te

    reasons: list[str] = []
    if decline_z <= REVIEW_Z:
        status = Status.REVIEW
        reasons.append(f"{spec.label} {abs(decline_z):.1f} SD below his 28-day normal")
    elif decline_z <= MONITOR_Z:
        status = Status.MONITOR
        reasons.append(f"{spec.label} {abs(decline_z):.1f} SD below his 28-day normal")
    elif declines >= MONITOR_DECLINE_SESSIONS and cumulative_drop > base.swc:
        status = Status.MONITOR
        reasons.append(f"{spec.label}: {declines} declining readings in a row")
    else:
        status = Status.CLEARED

    if status in (Status.REVIEW, Status.MONITOR):
        if beyond_noise is False:
            status = Status.CLEARED
            reasons = [f"{spec.label} drop inside test noise (TE {te:g} {spec.unit})"]
        elif beyond_noise is True:
            reasons[-1] += " and beyond test noise"
        else:
            reasons[-1] += "; test noise not yet estimated"

    raw_mean = -base.mean if spec.higher_is_worse else base.mean
    pct = (None if raw_mean == 0
           else round((today_val - raw_mean) / raw_mean * 100.0, 1))
    return DomainAssessment(domain=spec.domain, status=status, fresh=True,
                            today=round(today_val, 3), base=base,
                            pct=pct, decline_z=decline_z, observed_on=today_day,
                            consecutive_declines=declines, reasons=reasons,
                            te=te, beyond_noise=beyond_noise)
```

Replace the whole `load_context` function with:
```python
def _int_or_none(value: float | None) -> int | None:
    return None if value is None else int(round(value))


def load_context(readings: list[Reading], today: date) -> LoadContext:
    """Catapult workload. CONTEXT only; never sets a status."""
    def on(metric: str, day: date) -> float | None:
        vals = [r.value for r in readings if r.metric == metric and r.day == day]
        return sum(vals) if vals else None

    window = [r for r in readings if r.metric in (THROWS, PITCHES)
              and today - timedelta(days=LOAD_DAYS - 1) <= r.day <= today]
    return LoadContext(
        player_load_today=on(PLAYER_LOAD, today),
        throws_today=_int_or_none(on(THROWS, today)),
        pitches_today=_int_or_none(on(PITCHES, today)),
        throws_7d=_int_or_none(sum(r.value for r in window)) if window else None)
```

Change the signature of `assess_athlete` to:
```python
def assess_athlete(readings: list[Reading], today: date,
                   te: dict[str, float | None] | None = None) -> AthleteAssessment | None:
```

In `assess_athlete`, change the domain loop to:
```python
    te = te or {}
    domains: list[DomainAssessment] = []
    for spec in METRICS.values():
        series = _metric_series(readings, spec.column, today)
        domains.append(assess_domain(spec, series, today, te.get(spec.column)))
```

Change the `converging` line to:
```python
    converging = [d for d in assessable
                  if d.decline_z <= CONVERGENCE_Z and d.beyond_noise is not False]
```

Delete these two lines (no spike any more):
```python
    if load.spike and status in (Status.REVIEW, Status.MONITOR):
        reasons.append("during an acute training-load spike (context)")
```

Change `assess_squad` to pass TE through:
```python
def assess_squad(readings: list[Reading], today: date,
                 te: dict[str, float | None] | None = None) -> list[AthleteAssessment]:
    """Assess every athlete with data. Sorted worst-first."""
    by_athlete: dict[str, list[Reading]] = defaultdict(list)
    for r in readings:
        by_athlete[r.athlete_id].append(r)
    out = [a for group in by_athlete.values()
           if (a := assess_athlete(group, today, te)) is not None]
    return sorted(out, key=lambda a: (SEVERITY[a.status], _worst_z(a)))
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass (`15 passed`). Between Task 2 and this step the full suite cannot import the engine; that is expected.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): typical-error noise gate, convergence respects noise, Catapult load context"
```

---

### Task 4: Header parsing and units

**Files:**
- Create: `src/lineup_card/adapters/headers.py`
- Test: `tests/test_headers.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_headers.py`:
```python
import pytest

from lineup_card.adapters.headers import find_column, parse_header


def test_parse_header_with_unit():
    assert parse_header("Jump Height (Imp-Mom) [cm]") == ("Jump Height (Imp-Mom)", "cm")
    assert parse_header("RSI-modified [m/s]") == ("RSI-modified", "m/s")


def test_parse_header_without_unit():
    assert parse_header("Name") == ("Name", None)


def test_find_column_checks_unit():
    headers = ["Name", "Jump Height (Imp-Mom) [cm]"]
    assert find_column(headers, "Jump Height (Imp-Mom)", "cm") == "Jump Height (Imp-Mom) [cm]"


def test_find_column_wrong_unit_raises():
    with pytest.raises(ValueError, match="unit"):
        find_column(["Jump Height (Imp-Mom) [in]"], "Jump Height (Imp-Mom)", "cm")


def test_find_column_unknown_unit_raises():
    with pytest.raises(ValueError, match="Unknown unit"):
        find_column(["RSI-modified [furlongs]"], "RSI-modified", "m/s")


def test_find_column_missing_raises():
    with pytest.raises(ValueError, match="missing"):
        find_column(["Name"], "RSI-modified", "m/s")
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_headers.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/adapters/headers.py`**

```python
"""Vendor exports put the unit in the header: "Jump Height (Imp-Mom) [cm]".

Read the unit from the header and refuse anything unexpected, so a file
exported in inches never slips in as centimetres.
"""

from __future__ import annotations

import re

KNOWN_UNITS = {"cm", "in", "m/s", "s", "N", "Ns", "W", "kg", "AU"}
_HEADER = re.compile(r"^(?P<name>.*?)\s*\[(?P<unit>[^\]]+)\]\s*$")


def parse_header(header: str) -> tuple[str, str | None]:
    match = _HEADER.match(header.strip())
    if not match:
        return header.strip(), None
    return match["name"], match["unit"]


def find_column(headers: list[str], name: str, unit: str) -> str:
    """Return the header for `name`, checking its unit is `unit`."""
    for header in headers:
        found_name, found_unit = parse_header(header)
        if found_name != name:
            continue
        if found_unit not in KNOWN_UNITS:
            raise ValueError(f"Unknown unit [{found_unit}] in column '{header}'")
        if found_unit != unit:
            raise ValueError(f"Column '{header}' has unit [{found_unit}], expected [{unit}]")
        return header
    raise ValueError(f"Export is missing the column '{name} [{unit}]'")
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_headers.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapters): parse units from export headers and refuse unknown units"
```

---

### Task 5: VALD ForceDecks adapter

**Files:**
- Create: `src/lineup_card/adapters/vald.py`
- Test: `tests/test_vald.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_vald.py`:
```python
from datetime import date

import pytest

from lineup_card.adapters.vald import read_vald

HEAD = "Name,ExternalId,Date,Time,Test Type,Trial,Jump Height (Imp-Mom) [cm],RSI-modified [m/s]\n"


def write(tmp_path, body, head=HEAD):
    p = tmp_path / "vald_forcedecks_cmj.csv"
    p.write_text(head + body, encoding="utf-8")
    return p


def test_reads_cmj_trials(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,41.2,0.531\n"
                        "J. Doe,V001,2026-09-01,07:43,CMJ,2,40.8,0.524\n")
    rows = read_vald(p)
    assert len(rows) == 2
    assert rows[0].external_id == "V001" and rows[0].day == date(2026, 9, 1)
    assert rows[0].trial == 1 and rows[0].jump_height_cm == 41.2 and rows[0].rsi_mod == 0.531


def test_filters_other_test_types(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,SJ,1,38.0,\n"
                        "J. Doe,V001,2026-09-01,07:43,CMJ,1,41.0,0.53\n")
    assert [r.trial for r in read_vald(p)] == [1]


def test_blank_metric_is_none(tmp_path):
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,41.0,\n")
    assert read_vald(p)[0].rsi_mod is None


def test_wrong_unit_rejected(tmp_path):
    head = HEAD.replace("[cm]", "[in]")
    p = write(tmp_path, "J. Doe,V001,2026-09-01,07:42,CMJ,1,16.2,0.53\n", head)
    with pytest.raises(ValueError, match="expected"):
        read_vald(p)
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_vald.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/adapters/vald.py`**

```python
"""VALD ForceDecks CSV export -> one CmjTrial per row.

Column names are modeled on public examples; a club's Export Profile can
differ. Only CMJ rows are kept. A blank cell is missing, never zero.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from .headers import find_column

JUMP = ("Jump Height (Imp-Mom)", "cm")
RSI = ("RSI-modified", "m/s")
REQUIRED = {"Name", "ExternalId", "Date", "Test Type", "Trial"}


class CmjTrial(BaseModel):
    name: str
    external_id: str
    day: date
    trial: int
    jump_height_cm: float | None
    rsi_mod: float | None


def _num(cell: str) -> float | None:
    cell = cell.strip()
    return float(cell) if cell else None


def read_vald(path: Path) -> list[CmjTrial]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        missing = REQUIRED - set(headers)
        if missing:
            raise ValueError("VALD export is missing columns: " + ", ".join(sorted(missing)))
        jump_col = find_column(headers, *JUMP)
        rsi_col = find_column(headers, *RSI)
        out = []
        for row in reader:
            if row["Test Type"].strip().upper() != "CMJ":
                continue
            out.append(CmjTrial(
                name=row["Name"].strip(), external_id=row["ExternalId"].strip(),
                day=date.fromisoformat(row["Date"].strip()), trial=int(row["Trial"]),
                jump_height_cm=_num(row[jump_col]), rsi_mod=_num(row[rsi_col])))
        return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_vald.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapters): VALD ForceDecks CMJ reader"
```

---

### Task 6: Catapult OpenField adapter

**Files:**
- Create: `src/lineup_card/adapters/catapult.py`
- Test: `tests/test_catapult.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_catapult.py`:
```python
from datetime import date

from lineup_card.adapters.catapult import read_catapult

HEAD = ("player_name,period_name,period_number,start_time,end_time,duration,"
        "player_load,throw_count,pitch_count\n")


def write(tmp_path, body):
    p = tmp_path / "catapult_openfield.csv"
    p.write_text(HEAD + body, encoding="utf-8")
    return p


def test_reads_periods(tmp_path):
    p = write(tmp_path, "John Doe,Warm-up,1,2026-09-01T21:00:00Z,2026-09-01T21:20:00Z,1200,85.5,12,0\n")
    row = read_catapult(p)[0]
    assert row.player_name == "John Doe" and row.period_number == 1
    assert row.player_load == 85.5 and row.throw_count == 12 and row.pitch_count == 0


def test_session_date_is_local_club_time(tmp_path):
    # 00:30 UTC on Sep 2 is 7:30 p.m. Central on Sep 1
    p = write(tmp_path, "John Doe,Game,2,2026-09-02T00:30:00Z,2026-09-02T03:00:00Z,9000,210,30,95\n")
    assert read_catapult(p)[0].day == date(2026, 9, 1)


def test_blank_counts_are_none(tmp_path):
    p = write(tmp_path, "John Doe,Warm-up,1,2026-09-01T21:00:00Z,2026-09-01T21:20:00Z,1200,85.5,,\n")
    row = read_catapult(p)[0]
    assert row.throw_count is None and row.pitch_count is None
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_catapult.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/adapters/catapult.py`**

```python
"""Catapult OpenField CSV export -> one CatapultPeriod per row.

Column names are modeled on a public third-party import guide, not on
Catapult's own documentation. Times are UTC; the session date is the
club's local date, so a 7 p.m. game does not land on tomorrow.
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel

CLUB_TZ = ZoneInfo("America/Chicago")
REQUIRED = {"player_name", "period_name", "period_number", "start_time",
            "player_load", "throw_count", "pitch_count"}


class CatapultPeriod(BaseModel):
    player_name: str
    period_name: str
    period_number: int
    day: date
    player_load: float | None
    throw_count: int | None
    pitch_count: int | None


def _num(cell: str) -> float | None:
    cell = (cell or "").strip()
    return float(cell) if cell else None


def _int(cell: str) -> int | None:
    value = _num(cell)
    return None if value is None else int(value)


def local_day(utc_iso: str) -> date:
    stamp = datetime.fromisoformat(utc_iso.strip().replace("Z", "+00:00"))
    return stamp.astimezone(CLUB_TZ).date()


def read_catapult(path: Path) -> list[CatapultPeriod]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Catapult export is missing columns: " + ", ".join(sorted(missing)))
        return [CatapultPeriod(
            player_name=row["player_name"].strip(), period_name=row["period_name"].strip(),
            period_number=int(row["period_number"]), day=local_day(row["start_time"]),
            player_load=_num(row["player_load"]), throw_count=_int(row["throw_count"]),
            pitch_count=_int(row["pitch_count"])) for row in reader]
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_catapult.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapters): Catapult OpenField reader with local session date"
```

---

### Task 7: Wellness adapter

**Files:**
- Create: `src/lineup_card/adapters/wellness.py`
- Test: `tests/test_wellness.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_wellness.py`:
```python
import pytest

from lineup_card.adapters.wellness import read_wellness

HEAD = "athlete_id,date,sleep_quality,soreness,fatigue,stress,mood\n"


def test_score_is_sum_of_five_items(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,4,3,4,5,4\n")
    row = read_wellness(p)[0]
    assert row.athlete_id == "LC01" and row.score == 20


def test_out_of_range_item_rejected(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,6,3,4,5,4\n")
    with pytest.raises(ValueError, match="1 to 5"):
        read_wellness(p)


def test_blank_item_means_no_score(tmp_path):
    p = tmp_path / "wellness.csv"
    p.write_text(HEAD + "LC01,2026-09-01,4,,4,5,4\n")
    assert read_wellness(p)[0].score is None
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_wellness.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/adapters/wellness.py`**

```python
"""Morning wellness form -> one WellnessRow per player.

Five items, 1 to 5, where 5 is best (for soreness, 5 = no soreness).
The score is the sum (5 to 25). A skipped item means no score that day.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from pydantic import BaseModel

ITEMS = ("sleep_quality", "soreness", "fatigue", "stress", "mood")


class WellnessRow(BaseModel):
    athlete_id: str
    day: date
    score: int | None


def read_wellness(path: Path) -> list[WellnessRow]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = {"athlete_id", "date", *ITEMS} - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Wellness file is missing columns: " + ", ".join(sorted(missing)))
        out = []
        for row in reader:
            cells = [row[item].strip() for item in ITEMS]
            score = None
            if all(cells):
                values = [int(c) for c in cells]
                if any(v < 1 or v > 5 for v in values):
                    raise ValueError("Wellness items must be 1 to 5")
                score = sum(values)
            out.append(WellnessRow(athlete_id=row["athlete_id"].strip(),
                                   day=date.fromisoformat(row["date"].strip()), score=score))
        return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_wellness.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapters): wellness form reader"
```

---

### Task 8: Player crosswalk

**Files:**
- Create: `src/lineup_card/crosswalk.py`
- Test: `tests/test_crosswalk.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_crosswalk.py`:
```python
import pytest

from lineup_card.crosswalk import Crosswalk

HEAD = "lc_id,name,pos,vald_external_id,catapult_name\n"


def load(tmp_path, body):
    p = tmp_path / "crosswalk.csv"
    p.write_text(HEAD + body)
    return Crosswalk.load(p)


def test_resolves_each_source(tmp_path):
    cw = load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\n")
    assert cw.from_vald("V001") == "LC01"
    assert cw.from_catapult("John Doe") == "LC01"
    assert cw.from_catapult("john doe ") == "LC01"
    assert cw.player("LC01").pos == "RP"


def test_unknown_returns_none(tmp_path):
    cw = load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\n")
    assert cw.from_vald("V999") is None and cw.from_catapult("Jon Doe") is None


def test_duplicate_catapult_name_rejected(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        load(tmp_path, "LC01,J. Doe,RP,V001,John Doe\nLC02,J. Doe,C,V002,John Doe\n")


def test_unknown_position_rejected(tmp_path):
    with pytest.raises(ValueError, match="position"):
        load(tmp_path, "LC01,J. Doe,DH,V001,John Doe\n")
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_crosswalk.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/crosswalk.py`**

```python
"""One player, three IDs. The crosswalk maps VALD and Catapult identities
to a Lineup Card ID. Anything it cannot map is held out for review, never
guessed."""

from __future__ import annotations

import csv
from pathlib import Path

from pydantic import BaseModel

POSITIONS = ("SP", "RP", "C", "IF", "OF")


class Player(BaseModel):
    lc_id: str
    name: str
    pos: str


def _key(text: str) -> str:
    return " ".join(text.lower().split())


class Crosswalk:
    def __init__(self, players: dict[str, Player], vald: dict[str, str], catapult: dict[str, str]):
        self.players, self._vald, self._catapult = players, vald, catapult

    @classmethod
    def load(cls, path: Path) -> "Crosswalk":
        players: dict[str, Player] = {}
        vald: dict[str, str] = {}
        catapult: dict[str, str] = {}
        with path.open(newline="", encoding="utf-8-sig") as stream:
            for row in csv.DictReader(stream):
                lc_id = row["lc_id"].strip()
                if row["pos"].strip() not in POSITIONS:
                    raise ValueError(f"Unknown position '{row['pos']}' for {lc_id}")
                if lc_id in players:
                    raise ValueError(f"duplicate Lineup Card ID {lc_id}")
                players[lc_id] = Player(lc_id=lc_id, name=row["name"].strip(), pos=row["pos"].strip())
                for table, raw in ((vald, row["vald_external_id"].strip()),
                                   (catapult, _key(row["catapult_name"]))):
                    if raw in table:
                        raise ValueError(f"duplicate source identity '{raw}'")
                    table[raw] = lc_id
        return cls(players, vald, catapult)

    def from_vald(self, external_id: str) -> str | None:
        return self._vald.get(external_id.strip())

    def from_catapult(self, name: str) -> str | None:
        return self._catapult.get(_key(name))

    def player(self, lc_id: str) -> Player:
        return self.players[lc_id]
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_crosswalk.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: player crosswalk across VALD, Catapult and Lineup Card IDs"
```

---

### Task 9: Cleaning rules and the cleaning log

**Files:**
- Create: `src/lineup_card/clean.py`
- Test: `tests/test_clean.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_clean.py`:
```python
from datetime import date

from lineup_card.adapters.catapult import CatapultPeriod
from lineup_card.adapters.vald import CmjTrial
from lineup_card.adapters.wellness import WellnessRow
from lineup_card.clean import CleanLog, clean_catapult, clean_cmj, clean_wellness
from lineup_card.crosswalk import Crosswalk, Player

D = date(2026, 9, 1)
CW = Crosswalk({"LC01": Player(lc_id="LC01", name="J. Doe", pos="RP")},
               {"V001": "LC01"}, {"john doe": "LC01"})


def trial(n, rsi, jump=40.0, ext="V001"):
    return CmjTrial(name="J. Doe", external_id=ext, day=D, trial=n, jump_height_cm=jump, rsi_mod=rsi)


def values(readings, metric):
    return [round(r.value, 4) for r in readings if r.metric == metric]


def test_mean_of_valid_trials():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.50), trial(2, 0.52), trial(3, 0.54)], CW, log)
    assert values(out, "rsi_mod") == [0.52]
    assert values(out, "jump_height_cm") == [40.0]


def test_outlier_trial_dropped_and_logged():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.52), trial(2, 0.53), trial(3, 0.40)], CW, log)
    assert values(out, "rsi_mod") == [0.525]
    assert any(e.rule == "trial_outlier" and e.lc_id == "LC01" for e in log.entries)


def test_fewer_than_two_valid_trials_gives_no_value():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.52)], CW, log)
    assert values(out, "rsi_mod") == []
    assert any(e.rule == "too_few_trials" for e in log.entries)


def test_unmatched_vald_id_held_out():
    log = CleanLog()
    out = clean_cmj([trial(1, 0.5, ext="V999"), trial(2, 0.5, ext="V999")], CW, log)
    assert out == []
    assert log.held_out == [{"source": "vald", "raw": "V999", "reason": "not in crosswalk"}]


def period(n, name="Practice", load=50.0, throws=10, pitches=None, who="John Doe"):
    return CatapultPeriod(player_name=who, period_name=name, period_number=n, day=D,
                          player_load=load, throw_count=throws, pitch_count=pitches)


def test_periods_summed_and_session_total_ignored():
    log = CleanLog()
    out = clean_catapult([period(1), period(2, load=30.0, throws=5),
                          period(0, name="Session Total", load=80.0, throws=15)], CW, log)
    assert values(out, "player_load") == [80.0]
    assert values(out, "throw_count") == [15]
    assert values(out, "pitch_count") == []


def test_unmatched_catapult_name_held_out_once_per_day():
    log = CleanLog()
    clean_catapult([period(1, who="Jon Doe"), period(2, who="Jon Doe")], CW, log)
    assert log.held_out == [{"source": "catapult", "raw": "Jon Doe", "reason": "not in crosswalk"}]


def test_wellness_blank_score_skipped_and_unknown_id_held_out():
    log = CleanLog()
    out = clean_wellness([WellnessRow(athlete_id="LC01", day=D, score=None),
                          WellnessRow(athlete_id="LC77", day=D, score=20)], CW, log)
    assert out == []
    assert any(e.rule == "incomplete_form" for e in log.entries)
    assert log.held_out == [{"source": "wellness", "raw": "LC77", "reason": "not in crosswalk"}]
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_clean.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/clean.py`**

```python
"""Cleaning rules. Every decision is written to the CleanLog so the coach
can see it in the review step.

  Trials    Drop a CMJ trial more than 10% from the median of that day's
            trials (practitioner convention). Use the mean of the rest
            (Claudino et al. 2017). Fewer than 2 valid trials: no value.
  Sessions  Sum Catapult periods per player per day. Ignore any period
            named like a session total so nothing counts twice.
  Identity  Unmatched names or IDs are held out, never guessed.
  Missing   Missing stays missing. Nothing becomes zero.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from pydantic import BaseModel, Field

from .adapters.catapult import CatapultPeriod
from .adapters.vald import CmjTrial
from .adapters.wellness import WellnessRow
from .crosswalk import Crosswalk
from .models import JUMP_HEIGHT, PITCHES, PLAYER_LOAD, THROWS, Reading

OUTLIER_FRACTION = 0.10
MIN_TRIALS = 2


class LogEntry(BaseModel):
    lc_id: str
    day: date
    source: str
    rule: str
    detail: str


class CleanLog(BaseModel):
    entries: list[LogEntry] = Field(default_factory=list)
    held_out: list[dict] = Field(default_factory=list)

    def add(self, lc_id: str, day: date, source: str, rule: str, detail: str) -> None:
        self.entries.append(LogEntry(lc_id=lc_id, day=day, source=source, rule=rule, detail=detail))

    def hold(self, source: str, raw: str) -> None:
        item = {"source": source, "raw": raw, "reason": "not in crosswalk"}
        if item not in self.held_out:
            self.held_out.append(item)


def _reading(cw: Crosswalk, lc_id: str, day: date, metric: str, value: float, source: str) -> Reading:
    p = cw.player(lc_id)
    return Reading(athlete_id=lc_id, name=p.name, pos=p.pos, day=day,
                   metric=metric, value=value, source=source)


def _clean_trials(values: list[float]) -> tuple[list[float], list[float]]:
    median = statistics.median(values)
    keep = [v for v in values if abs(v - median) <= OUTLIER_FRACTION * median]
    drop = [v for v in values if v not in keep]
    return keep, drop


def clean_cmj(trials: list[CmjTrial], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    groups: dict[tuple[str, date], list[CmjTrial]] = defaultdict(list)
    for t in trials:
        lc_id = cw.from_vald(t.external_id)
        if lc_id is None:
            log.hold("vald", t.external_id)
            continue
        groups[(lc_id, t.day)].append(t)

    out: list[Reading] = []
    for (lc_id, day), group in sorted(groups.items()):
        rsi = [t.rsi_mod for t in group if t.rsi_mod is not None]
        if not rsi:
            continue
        keep, drop = _clean_trials(rsi)
        for value in drop:
            log.add(lc_id, day, "vald", "trial_outlier",
                    f"RSI-mod trial {value:.3f} more than 10% from the set median; dropped")
        if len(keep) < MIN_TRIALS:
            log.add(lc_id, day, "vald", "too_few_trials",
                    f"{len(keep)} valid CMJ trial(s); no value recorded today")
            continue
        out.append(_reading(cw, lc_id, day, "rsi_mod", statistics.fmean(keep), "vald"))
        kept_jumps = [t.jump_height_cm for t in group
                      if t.rsi_mod in keep and t.jump_height_cm is not None]
        if kept_jumps:
            out.append(_reading(cw, lc_id, day, JUMP_HEIGHT, statistics.fmean(kept_jumps), "vald"))
    return out


def clean_catapult(periods: list[CatapultPeriod], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    sums: dict[tuple[str, date, str], float] = defaultdict(float)
    for p in periods:
        if "total" in p.period_name.lower():
            continue
        lc_id = cw.from_catapult(p.player_name)
        if lc_id is None:
            log.hold("catapult", p.player_name)
            continue
        for metric, value in ((PLAYER_LOAD, p.player_load), (THROWS, p.throw_count),
                              (PITCHES, p.pitch_count)):
            if value is not None:
                sums[(lc_id, p.day, metric)] += value
    return [_reading(cw, lc_id, day, metric, value, "catapult")
            for (lc_id, day, metric), value in sorted(sums.items())]


def clean_wellness(rows: list[WellnessRow], cw: Crosswalk, log: CleanLog) -> list[Reading]:
    out = []
    for r in rows:
        if r.athlete_id not in cw.players:
            log.hold("wellness", r.athlete_id)
            continue
        if r.score is None:
            log.add(r.athlete_id, r.day, "wellness", "incomplete_form",
                    "wellness form incomplete; no score today")
            continue
        out.append(_reading(cw, r.athlete_id, r.day, "wellness_score", r.score, "wellness"))
    return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_clean.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cleaning rules with a visible cleaning log"
```

---

### Task 10: Context frames (typical error, position, team, league)

**Files:**
- Create: `src/lineup_card/frames.py`
- Test: `tests/test_frames.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_frames.py`:
```python
import math
from datetime import date, timedelta

from lineup_card.frames import (LEAGUE_REFERENCE, position_medians, team_shift,
                                typical_error)
from lineup_card.models import Reading

D0 = date(2026, 8, 1)


def r(aid, day, value, pos="RP", metric="rsi_mod"):
    return Reading(athlete_id=aid, name=aid, pos=pos, day=day, metric=metric, value=value)


def test_typical_error_from_consecutive_differences():
    rows = []
    for aid in ("A", "B"):
        for i in range(12):
            rows.append(r(aid, D0 + timedelta(days=i), 0.50 + (0.02 if i % 2 else 0.0)))
    te = typical_error(rows, "rsi_mod", D0 + timedelta(days=12))
    # differences alternate +0.02 / -0.02, so TE is about 0.02 / sqrt(2)
    assert math.isclose(te, 0.02 / 2 ** 0.5, rel_tol=0.1)


def test_typical_error_needs_enough_pairs():
    rows = [r("A", D0 + timedelta(days=i), 0.5) for i in range(4)]
    assert typical_error(rows, "rsi_mod", D0 + timedelta(days=5)) is None


def test_typical_error_excludes_today():
    rows = [r("A", D0 + timedelta(days=i), 0.50 + (0.02 if i % 2 else 0.0)) for i in range(12)]
    rows.append(r("A", D0 + timedelta(days=12), 0.10))
    with_today = typical_error(rows, "rsi_mod", D0 + timedelta(days=12))
    assert with_today < 0.05


def test_position_medians_with_group_size():
    z = {"A": -1.0, "B": -0.2, "C": 0.4, "D": -2.0}
    pos = {"A": "RP", "B": "RP", "C": "RP", "D": "C"}
    out = position_medians(z, pos)
    assert out["RP"] == {"median_z": -0.2, "n": 3}
    assert out["C"] == {"median_z": -2.0, "n": 1}


def test_team_shift_beyond_noise():
    changes = [-0.04, -0.035, -0.05, -0.03, -0.045]
    pct = [-8.0, -7.0, -9.5, -6.0, -8.5]
    shift = team_shift(changes, pct, te=0.02)
    assert shift == {"median_pct": -8.0, "beyond_noise": True, "n": 5}


def test_team_shift_inside_noise_and_empty():
    assert team_shift([-0.005, 0.004, 0.0], [-1, 1, 0], te=0.02)["beyond_noise"] is False
    assert team_shift([], [], te=0.02) is None


def test_league_reference_is_labeled_illustrative():
    assert "illustrative" in LEAGUE_REFERENCE["rsi_mod"]["label"]
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_frames.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/frames.py`**

```python
"""Context frames. None of these ever set a status.

  Typical error  Pooled across the squad from each player's consecutive
                 readings in the 28 days before today:
                 TE = SD(differences) / sqrt(2)  (Hopkins 2000).
  Position       Median of today's z by role, with n. Groups are small at
                 Triple-A, so a median, and n is always shown.
  Team           Median of today's raw change vs each player's normal.
                 Beyond noise when its size exceeds TE.
  League         One illustrative value per metric. No public MiLB VALD
                 norm exists; the label says so.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, timedelta

from .models import Reading

BASELINE_DAYS = 28
MIN_PAIRS = 10

LEAGUE_REFERENCE = {
    "rsi_mod": {"value": 0.52, "unit": "m/s",
                "label": "illustrative, not a published MLB or MiLB norm"},
    "jump_height_cm": {"value": 42.0, "unit": "cm",
                       "label": "illustrative, not a published MLB or MiLB norm"},
}


def typical_error(readings: list[Reading], metric: str, today: date) -> float | None:
    start = today - timedelta(days=BASELINE_DAYS)
    by_athlete: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for r in readings:
        if r.metric == metric and start <= r.day < today:
            by_athlete[r.athlete_id].append((r.day, r.value))
    diffs = []
    for points in by_athlete.values():
        values = [v for _, v in sorted(points)]
        diffs += [b - a for a, b in zip(values, values[1:])]
    if len(diffs) < MIN_PAIRS:
        return None
    return round(statistics.stdev(diffs) / 2 ** 0.5, 4)


def position_medians(z_by_id: dict[str, float], pos_by_id: dict[str, str]) -> dict[str, dict]:
    groups: dict[str, list[float]] = defaultdict(list)
    for lc_id, z in z_by_id.items():
        groups[pos_by_id[lc_id]].append(z)
    return {pos: {"median_z": round(statistics.median(zs), 2), "n": len(zs)}
            for pos, zs in groups.items()}


def team_shift(raw_changes: list[float], pct_changes: list[float], te: float | None) -> dict | None:
    if not raw_changes:
        return None
    median_raw = statistics.median(raw_changes)
    return {"median_pct": round(statistics.median(pct_changes), 1),
            "beyond_noise": te is not None and abs(median_raw) > te,
            "n": len(raw_changes)}
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_frames.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: context frames (typical error, position medians, team shift, league reference)"
```

---

### Task 11: Day builder (one day's JSON)

**Files:**
- Create: `src/lineup_card/day.py`
- Test: `tests/test_day.py`

JSON contract (the web app depends on these exact keys):
```json
{
  "date": "2026-09-20", "synthetic": true,
  "club": "Fictional Triple-A Club",
  "schedule": {"opponent": "...", "home_away": "home", "note": ""},
  "te": {"rsi_mod": 0.03, "wellness_score": 1.4},
  "team_shift": {"median_pct": -6.0, "beyond_noise": true, "n": 26} ,
  "league_reference": {...},
  "players": [{
    "id": "LC01", "name": "J. Ortega", "pos": "RP",
    "status": "check_in", "word": "Check in", "magnitude": "▼ large",
    "reasons": ["RSI-mod 2.3 SD below his 28-day normal and beyond test noise"],
    "rsi": {"today": 0.45, "mean": 0.55, "sd": 0.02, "z": -2.3, "pct": -18.2, "beyond_noise": true},
    "wellness": {"today": 17, "mean": 20.5, "sd": 1.2, "z": -1.9, "pct": -17.1, "beyond_noise": true},
    "jump_height_cm": 39.8, "position_median_z": -0.3, "position_n": 8,
    "load": {"player_load_today": 120.0, "throws_today": 25, "pitches_today": 18, "throws_7d": 140},
    "trend": [{"date": "2026-09-07", "z": 0.2}]
  }],
  "held_out": [{"source": "catapult", "raw": "Mike Daley", "reason": "not in crosswalk"}],
  "cleaning_log": [{"lc_id": "LC05", "day": "2026-09-20", "source": "vald", "rule": "trial_outlier", "detail": "..."}]
}
```

- [ ] **Step 1: Write the failing tests**

`tests/test_day.py`:
```python
from datetime import date, timedelta

from lineup_card.clean import CleanLog
from lineup_card.crosswalk import Crosswalk, Player
from lineup_card.day import STATUS_WORDS, build_day, magnitude
from lineup_card.models import Reading, Status

D0 = date(2026, 8, 20)
TODAY = D0 + timedelta(days=20)
PLAYERS = {"LC01": Player(lc_id="LC01", name="J. Ortega", pos="RP"),
           "LC02": Player(lc_id="LC02", name="K. Ruiz", pos="SP")}
CW = Crosswalk(PLAYERS, {}, {})


def rows():
    out = []
    for i in range(21):
        day = D0 + timedelta(days=i)
        rsi = 0.45 if i == 20 else 0.55 + (0.02 if i % 2 else 0.0)
        for metric, value in (("rsi_mod", rsi), ("wellness_score", 20 + i % 2),
                              ("throw_count", 20)):
            out.append(Reading(athlete_id="LC01", name="J. Ortega", pos="RP", day=day,
                               metric=metric, value=value))
    out.append(Reading(athlete_id="LC02", name="K. Ruiz", pos="SP", day=TODAY,
                       metric="rsi_mod", value=0.5))
    return out


def test_status_words():
    assert STATUS_WORDS[Status.REVIEW] == ("check_in", "Check in")
    assert STATUS_WORDS[Status.INSUFFICIENT] == ("not_enough_data", "Not enough data")


def test_magnitude():
    assert magnitude(-2.4) == "▼ large"
    assert magnitude(-1.5) == "▼ moderate"
    assert magnitude(-0.3) == "– within noise"
    assert magnitude(None) == ""


def test_build_day_shape_and_statuses():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "Fictional Visitors",
                                                    "home_away": "home", "note": ""})
    assert day["synthetic"] is True and day["date"] == TODAY.isoformat()
    by_id = {p["id"]: p for p in day["players"]}
    assert by_id["LC01"]["status"] == "check_in" and by_id["LC01"]["word"] == "Check in"
    assert by_id["LC02"]["status"] == "not_enough_data"
    assert by_id["LC01"]["load"]["throws_7d"] == 140
    assert len(by_id["LC01"]["trend"]) == 14
    assert by_id["LC01"]["rsi"]["beyond_noise"] in (True, None)


def test_players_sorted_worst_first():
    day = build_day(rows(), TODAY, CW, CleanLog(), {"opponent": "", "home_away": "", "note": ""})
    assert day["players"][0]["id"] == "LC01"
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_day.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/day.py`**

```python
"""Build one day's JSON for the web app. Every number the card shows is
computed here; the browser only displays it."""

from __future__ import annotations

from datetime import date, timedelta

from .clean import CleanLog
from .crosswalk import Crosswalk
from .engine import assess_squad, compute_baseline, goodness, z_score
from .frames import LEAGUE_REFERENCE, position_medians, team_shift, typical_error
from .models import JUMP_HEIGHT, METRICS, AthleteAssessment, Domain, DomainAssessment, Reading, Status

CLUB = "Fictional Triple-A Club"
TREND_DAYS = 14
STATUS_WORDS = {
    Status.REVIEW: ("check_in", "Check in"),
    Status.MONITOR: ("watch", "Watch"),
    Status.CLEARED: ("no_change", "No change"),
    Status.INSUFFICIENT: ("not_enough_data", "Not enough data"),
}


def magnitude(z: float | None) -> str:
    if z is None:
        return ""
    if z <= -2.0:
        return "▼ large"
    if z <= -1.2:
        return "▼ moderate"
    return "– within noise"


def _domain_json(d: DomainAssessment) -> dict:
    if d.base is None:
        return {"today": d.today, "mean": None, "sd": None, "z": None, "pct": None,
                "beyond_noise": None}
    return {"today": d.today, "mean": round(d.base.mean, 3), "sd": round(d.base.sd, 3),
            "z": round(d.decline_z, 2), "pct": d.pct, "beyond_noise": d.beyond_noise}


def _trend(readings: list[Reading], lc_id: str, today: date) -> list[dict]:
    """Daily RSI-mod z vs the baseline that applied on each day."""
    spec = METRICS[Domain.NEUROMUSCULAR]
    series = sorted((r.day, r.value) for r in readings
                    if r.athlete_id == lc_id and r.metric == spec.column)
    out = []
    for offset in range(TREND_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        value = next((v for d, v in series if d == day), None)
        prior = [v for d, v in series if day - timedelta(days=28) <= d < day]
        base = compute_baseline([goodness(v, spec.higher_is_worse) for v in prior])
        z = None if value is None or base is None else round(z_score(value, base), 2)
        out.append({"date": day.isoformat(), "z": z})
    return out


def _latest(readings: list[Reading], lc_id: str, metric: str, today: date) -> float | None:
    vals = [r.value for r in readings if r.athlete_id == lc_id and r.metric == metric and r.day == today]
    return round(vals[0], 1) if vals else None


def build_day(readings: list[Reading], today: date, cw: Crosswalk, log: CleanLog,
              schedule: dict) -> dict:
    te = {spec.column: typical_error(readings, spec.column, today) for spec in METRICS.values()}
    assessed: list[AthleteAssessment] = assess_squad(readings, today, te)

    rsi_by_id = {a.athlete_id: next(d for d in a.domains if d.domain is Domain.NEUROMUSCULAR)
                 for a in assessed}
    z_by_id = {k: d.decline_z for k, d in rsi_by_id.items() if d.decline_z is not None}
    medians = position_medians(z_by_id, {a.athlete_id: a.pos for a in assessed})
    tested = [d for d in rsi_by_id.values() if d.base is not None and d.observed_on == today]
    shift = team_shift([d.today - d.base.mean for d in tested],
                       [d.pct for d in tested if d.pct is not None], te["rsi_mod"])

    players = []
    for a in assessed:
        status, word = STATUS_WORDS[a.status]
        rsi = rsi_by_id[a.athlete_id]
        well = next(d for d in a.domains if d.domain is Domain.PERCEPTUAL)
        group = medians.get(a.pos, {"median_z": None, "n": 0})
        players.append({
            "id": a.athlete_id, "name": a.name, "pos": a.pos,
            "status": status, "word": word, "magnitude": magnitude(rsi.decline_z),
            "reasons": a.reasons or [r for d in a.domains for r in d.reasons],
            "rsi": _domain_json(rsi), "wellness": _domain_json(well),
            "jump_height_cm": _latest(readings, a.athlete_id, JUMP_HEIGHT, today),
            "position_median_z": group["median_z"], "position_n": group["n"],
            "load": a.load.model_dump(),
            "trend": _trend(readings, a.athlete_id, today),
        })

    return {
        "date": today.isoformat(), "synthetic": True, "club": CLUB, "schedule": schedule,
        "te": te, "team_shift": shift, "league_reference": LEAGUE_REFERENCE,
        "players": players,
        "held_out": log.held_out,
        "cleaning_log": [e.model_dump(mode="json") for e in log.entries if e.day == today],
    }
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_day.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: build one day's JSON with status words, context and trends"
```

---

### Task 12: Vendor API stub

**Files:**
- Create: `src/lineup_card/adapters/api_stub.py`
- Test: `tests/test_api_stub.py`

- [ ] **Step 1: Write the failing test**

`tests/test_api_stub.py`:
```python
from datetime import date

import pytest

from lineup_card.adapters.api_stub import VendorAPI


def test_stub_explains_what_is_needed():
    api = VendorAPI(vendor="VALD")
    with pytest.raises(RuntimeError, match="club account"):
        api.fetch(date(2026, 9, 1), date(2026, 9, 2))
```

- [ ] **Step 2: Run to see it fail**

Run: `.venv/bin/python -m pytest tests/test_api_stub.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/adapters/api_stub.py`**

```python
"""Where a live VALD or Catapult connection would plug in.

A real client needs a club account, API credentials and a data agreement.
It would return the same rows the CSV readers return, so nothing after
this point changes. Without credentials it stops with a clear message.
"""

from __future__ import annotations

from datetime import date


class VendorAPI:
    def __init__(self, vendor: str, token: str | None = None):
        self.vendor, self.token = vendor, token

    def fetch(self, start: date, end: date) -> list:
        raise RuntimeError(
            f"{self.vendor} live connection needs a club account, API credentials "
            "and a data agreement. Use the CSV exports in the inbox instead.")
```

- [ ] **Step 4: Run the test**

Run: `.venv/bin/python -m pytest tests/test_api_stub.py -q`
Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapters): vendor API stub that explains the credentials it needs"
```

---

### Task 13: Fictional data generator

**Files:**
- Create: `scripts/generate_fictional.py`
- Test: `tests/test_generate.py`

Scenario (all invented): 2026-08-10 to 2026-09-20. No testing on Mondays (off days). Road trip arrival at 4 a.m. on 2026-09-15, whole roster RSI-mod down about 8% that day. `J. Ortega` (RP) declines over 2026-09-16 to 2026-09-20. `T. Brandt` (OF) is very steady and has a small drop on 2026-09-20 (big z, inside noise). `K. Ruiz` (SP) is a call-up who arrives on 2026-09-12. From 2026-09-18 Catapult spells `M. Daley` as "Mike Daley" while the crosswalk says "Michael Daley". About one CMJ set in fifteen has a bad trial.

- [ ] **Step 1: Write the failing tests**

`tests/test_generate.py`:
```python
import csv

from generate_fictional import generate


def test_generator_is_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate(a)
    generate(b)
    fa = (a / "inbox/2026-09-20/vald_forcedecks_cmj.csv").read_text()
    fb = (b / "inbox/2026-09-20/vald_forcedecks_cmj.csv").read_text()
    assert fa == fb


def test_roster_and_scenario_files(tmp_path):
    generate(tmp_path)
    roster = list(csv.DictReader((tmp_path / "crosswalk.csv").open()))
    assert len(roster) == 28
    assert [r["pos"] for r in roster].count("RP") == 8
    assert not (tmp_path / "inbox/2026-09-14").exists()          # Monday off day
    ruiz_early = (tmp_path / "inbox/2026-09-10/vald_forcedecks_cmj.csv").read_text()
    assert "K. Ruiz" not in ruiz_early
    cat = (tmp_path / "inbox/2026-09-19/catapult_openfield.csv").read_text()
    assert "Mike Daley" in cat and "Session Total" in cat
    schedule = list(csv.DictReader((tmp_path / "schedule.csv").open()))
    assert any("Road trip" in s["note"] for s in schedule)
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_generate.py -q`
Expected: FAIL (ModuleNotFoundError: generate_fictional).

- [ ] **Step 3: Implement `scripts/generate_fictional.py`**

```python
"""Write a fictional Triple-A roster and six weeks of vendor-shaped exports.

Every name is invented. Column names are modeled on public examples.
Run: .venv/bin/python scripts/generate_fictional.py
"""

from __future__ import annotations

import csv
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START, END = date(2026, 8, 10), date(2026, 9, 20)
TRAVEL_DAY = date(2026, 9, 15)
CALLUP_DAY = date(2026, 9, 12)
MISSPELL_FROM = date(2026, 9, 18)
SEED = 20261021

ROSTER = [  # lc_id, short name, full name, pos
    ("LC01", "J. Ortega", "Jorge Ortega", "RP"), ("LC02", "K. Ruiz", "Kevin Ruiz", "SP"),
    ("LC03", "T. Brandt", "Tyler Brandt", "OF"), ("LC04", "M. Daley", "Michael Daley", "C"),
    ("LC05", "A. Whitcomb", "Aaron Whitcomb", "SP"), ("LC06", "R. Okafor", "Ryan Okafor", "SP"),
    ("LC07", "D. Lindqvist", "Daniel Lindqvist", "SP"), ("LC08", "S. Marrero", "Samuel Marrero", "SP"),
    ("LC09", "P. Haddad", "Peter Haddad", "SP"), ("LC10", "L. Fenwick", "Luke Fenwick", "RP"),
    ("LC11", "E. Castellano", "Eric Castellano", "RP"), ("LC12", "B. Yamada", "Ben Yamada", "RP"),
    ("LC13", "C. Duvall", "Chris Duvall", "RP"), ("LC14", "G. Pruitt", "Grant Pruitt", "RP"),
    ("LC15", "H. Soto-Reyes", "Hector Soto-Reyes", "RP"), ("LC16", "N. Ambrose", "Nick Ambrose", "RP"),
    ("LC17", "O. Kessler", "Owen Kessler", "C"), ("LC18", "V. Ibarra", "Victor Ibarra", "C"),
    ("LC19", "W. Thorne", "Will Thorne", "IF"), ("LC20", "F. Quintero", "Felix Quintero", "IF"),
    ("LC21", "J. Mabry", "Jake Mabry", "IF"), ("LC22", "I. Novak", "Ivan Novak", "IF"),
    ("LC23", "Z. Pellegrino", "Zach Pellegrino", "IF"), ("LC24", "A. Boateng", "Andre Boateng", "IF"),
    ("LC25", "M. Serrano", "Marco Serrano", "OF"), ("LC26", "T. Gallagher", "Tom Gallagher", "OF"),
    ("LC27", "D. Achebe", "David Achebe", "OF"), ("LC28", "R. Vance", "Riley Vance", "OF"),
]
OPPONENTS = ["Fictional Visitors", "Lakeside Fictionals", "Prairie Placeholders", "Harbor Example Club"]


def _days():
    d = START
    while d <= END:
        if d.weekday() != 0:  # Mondays off
            yield d
        d += timedelta(days=1)


def _rsi_today(rng, base, noise, lc_id, day):
    value = rng.gauss(base, noise)
    if day == TRAVEL_DAY and lc_id != "LC03":  # Brandt stayed back for treatment
        value *= 0.92
    if lc_id == "LC01" and day >= date(2026, 9, 16):
        value *= 1 - 0.045 * ((day - date(2026, 9, 15)).days)
    if lc_id == "LC03" and day == END:
        value = base - 0.012
    return max(value, 0.2)


def generate(out: Path) -> None:
    rng = random.Random(SEED)
    out.mkdir(parents=True, exist_ok=True)
    with (out / "crosswalk.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lc_id", "name", "pos", "vald_external_id", "catapult_name"])
        for lc_id, short, full, pos in ROSTER:
            w.writerow([lc_id, short, pos, f"V{lc_id[2:]}0", full])

    profile = {lc_id: (rng.uniform(0.46, 0.62), rng.uniform(38, 47)) for lc_id, *_ in ROSTER}
    noise = {lc_id: 0.004 if lc_id == "LC03" else 0.028 for lc_id, *_ in ROSTER}

    with (out / "schedule.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "opponent", "home_away", "note"])
        for i, day in enumerate(_days()):
            note = "Road trip: 4 a.m. arrival" if day == TRAVEL_DAY else ""
            w.writerow([day.isoformat(), OPPONENTS[(i // 6) % len(OPPONENTS)],
                        "away" if (i // 6) % 2 else "home", note])

    for n, day in enumerate(_days()):
        folder = out / "inbox" / day.isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        active = [p for p in ROSTER if not (p[0] == "LC02" and day < CALLUP_DAY)]
        with (folder / "vald_forcedecks_cmj.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Name", "ExternalId", "Date", "Time", "Test Type", "Trial",
                        "Jump Height (Imp-Mom) [cm]", "RSI-modified [m/s]"])
            for lc_id, short, _, _ in active:
                base_rsi, base_jump = profile[lc_id]
                rsi = _rsi_today(rng, base_rsi, noise[lc_id], lc_id, day)
                jump = base_jump * rsi / base_rsi
                bad = rng.random() < 1 / 15 and lc_id != "LC03"
                for t in (1, 2, 3):
                    factor = 0.75 if bad and t == 3 else rng.gauss(1, 0.01 if lc_id == "LC03" else 0.02)
                    w.writerow([short, f"V{lc_id[2:]}0", day.isoformat(), f"07:{40 + t:02d}", "CMJ", t,
                                round(jump * factor, 1), round(rsi * factor, 3)])
        with (folder / "catapult_openfield.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["player_name", "period_name", "period_number", "start_time", "end_time",
                        "duration", "player_load", "throw_count", "pitch_count"])
            game = datetime(day.year, day.month, day.day, 23, 5, tzinfo=timezone.utc)  # 6:05 p.m. CT
            for lc_id, _, full, pos in active:
                name = "Mike Daley" if lc_id == "LC04" and day >= MISSPELL_FROM else full
                starts = pos == "SP" and (n + int(lc_id[2:])) % 5 == 0
                pitches = rng.randint(80, 100) if starts else (
                    rng.randint(12, 28) if pos == "RP" and rng.random() < 0.45 else 0)
                prep = rng.uniform(60, 90)
                game_load = rng.uniform(90, 160) if pos not in ("SP", "RP") or pitches else rng.uniform(20, 40)
                throws_prep = rng.randint(15, 35)
                throws_game = rng.randint(10, 60) if pos in ("C", "IF", "OF") else 0
                for k, (pname, start, load, throws, pc) in enumerate((
                        ("Warm-up", game - timedelta(hours=2), prep, throws_prep, 0),
                        ("Game", game, game_load, throws_game, pitches)), start=1):
                    w.writerow([name, pname, k, start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                (start + timedelta(minutes=50)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                3000, round(load, 1), throws, pc])
                w.writerow([name, "Session Total", 0, (game - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            game.strftime("%Y-%m-%dT%H:%M:%SZ"), 6000, round(prep + game_load, 1),
                            throws_prep + throws_game, pitches])
        with (folder / "wellness.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["athlete_id", "date", "sleep_quality", "soreness", "fatigue", "stress", "mood"])
            for lc_id, *_ in active:
                items = [min(5, max(1, round(rng.gauss(4.0, 0.6)))) for _ in range(5)]
                if lc_id == "LC01" and day >= date(2026, 9, 18):
                    items = [max(1, i - 1) for i in items]
                if day == TRAVEL_DAY:
                    items[0] = max(1, items[0] - 2)
                if rng.random() < 0.02:
                    items[1] = ""
                w.writerow([lc_id, day.isoformat(), *items])


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "fictional"
    generate(target)
    print(f"Wrote fictional data to {target}")
```

Note: the Session Total row's `start_time` is 2 hours before the game, which is still the same local date, so the date logic is exercised by the real periods, not by this row.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_generate.py -q`
Expected: `2 passed`.

- [ ] **Step 5: Generate the real fixture and commit**

```bash
.venv/bin/python scripts/generate_fictional.py
git add -A
git commit -m "feat: seeded fictional Triple-A roster and six weeks of vendor-shaped exports"
```

---

### Task 14: Pipeline and site builder

**Files:**
- Create: `src/lineup_card/pipeline.py`, `scripts/build_site.py`
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Write the failing tests (scenario checks on the real fixture)**

`tests/test_pipeline.py`:
```python
from datetime import date
from pathlib import Path

import pytest

from lineup_card.pipeline import run_day

DATA = Path(__file__).parent.parent / "data" / "fictional"


@pytest.fixture(scope="module")
def last_day():
    return run_day(DATA, date(2026, 9, 20))


def by_id(day):
    return {p["id"]: p for p in day["players"]}


def test_declining_reliever_is_check_in(last_day):
    assert by_id(last_day)["LC01"]["status"] == "check_in"


def test_steady_player_small_drop_is_no_change_by_noise_gate(last_day):
    brandt = by_id(last_day)["LC03"]
    assert brandt["rsi"]["z"] <= -1.2          # the z gate alone would flag him
    assert brandt["status"] == "no_change"
    assert brandt["rsi"]["beyond_noise"] is False


def test_callup_is_not_enough_data(last_day):
    assert by_id(last_day)["LC02"]["status"] == "not_enough_data"


def test_misspelled_catapult_name_held_out(last_day):
    assert {"source": "catapult", "raw": "Mike Daley", "reason": "not in crosswalk"} in last_day["held_out"]


def test_travel_day_team_shift():
    day = run_day(DATA, date(2026, 9, 15))
    assert day["team_shift"]["beyond_noise"] is True
    assert day["team_shift"]["median_pct"] < -4
    assert "Road trip" in day["schedule"]["note"]


def test_no_day_for_monday_off():
    with pytest.raises(FileNotFoundError):
        run_day(DATA, date(2026, 9, 14))
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python -m pytest tests/test_pipeline.py -q`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/lineup_card/pipeline.py`**

```python
"""Read every inbox folder up to a date, clean, flag and build that day.

Baselines need history, so a run for one date reads all earlier inboxes.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from .adapters.catapult import read_catapult
from .adapters.vald import read_vald
from .adapters.wellness import read_wellness
from .clean import CleanLog, clean_catapult, clean_cmj, clean_wellness
from .crosswalk import Crosswalk
from .day import build_day


def _schedule(data: Path, today: date) -> dict:
    with (data / "schedule.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            if row["date"] == today.isoformat():
                return {"opponent": row["opponent"], "home_away": row["home_away"], "note": row["note"]}
    return {"opponent": "", "home_away": "", "note": ""}


def run_day(data: Path, today: date) -> dict:
    if not (data / "inbox" / today.isoformat()).is_dir():
        raise FileNotFoundError(f"No inbox for {today.isoformat()} (off day or not delivered)")
    cw = Crosswalk.load(data / "crosswalk.csv")
    log = CleanLog()
    readings = []
    for folder in sorted((data / "inbox").iterdir()):
        if not folder.is_dir() or folder.name > today.isoformat():
            continue
        is_today = folder.name == today.isoformat()
        day_log = log if is_today else CleanLog()
        for name, read, clean in (("vald_forcedecks_cmj.csv", read_vald, clean_cmj),
                                  ("catapult_openfield.csv", read_catapult, clean_catapult),
                                  ("wellness.csv", read_wellness, clean_wellness)):
            path = folder / name
            if path.exists():
                readings += clean(read(path), cw, day_log)
    return build_day(readings, today, cw, log, _schedule(data, today))
```

- [ ] **Step 4: Implement `scripts/build_site.py`**

```python
"""Run the pipeline for the last 14 game days and write web/data/.

Run: .venv/bin/python scripts/build_site.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from lineup_card.pipeline import run_day  # noqa: E402

DATA = ROOT / "data" / "fictional"
OUT = ROOT / "web" / "data"
SHOW_DAYS = 14


def main() -> None:
    dates = sorted(p.name for p in (DATA / "inbox").iterdir() if p.is_dir())[-SHOW_DAYS:]
    (OUT / "days").mkdir(parents=True, exist_ok=True)
    for d in dates:
        day = run_day(DATA, date.fromisoformat(d))
        (OUT / "days" / f"{d}.json").write_text(json.dumps(day, indent=1, ensure_ascii=False))
        print(f"{d}: {sum(p['status'] == 'check_in' for p in day['players'])} check in")
    (OUT / "index.json").write_text(json.dumps({"dates": dates, "latest": dates[-1]}, indent=1))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run all tests, then build the data**

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/build_site.py
```
Expected: all tests pass. The build prints 14 lines; `2026-09-20` shows at least 1 check in.

If a scenario test fails because of random draws (for example Ortega lands on Watch), adjust only the scenario numbers in `generate_fictional.py` (the decline step `0.045`, or Brandt's `0.012`), regenerate, and rerun. Never change the engine to fit the data.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: pipeline over inbox history and static site data builder"
```

---

### Task 15: Pure web logic (tested in Node)

**Files:**
- Create: `web/js/logic.js`
- Test: `tests/web/logic.test.mjs`

- [ ] **Step 1: Write the failing tests**

`tests/web/logic.test.mjs`:
```js
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
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/web/*.test.mjs`
Expected: FAIL (cannot find module `web/js/logic.js`).

- [ ] **Step 3: Implement `web/js/logic.js`**

```js
// Pure functions. No DOM, no storage. Tested with node --test.

export const WORDS = {
  check_in: "Check in",
  watch: "Watch",
  no_change: "No change",
  not_enough_data: "Not enough data",
};
export const FLAGGED = new Set(["check_in", "watch"]);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const lastName = (name) => norm(name).split(" ").pop();

export function parseLineup(text, players) {
  const ids = [];
  const unmatched = [];
  for (const raw of text.split(/\n|,/).map((l) => l.trim()).filter(Boolean)) {
    const key = norm(raw);
    const hit = players.find((p) => p.id.toLowerCase() === key || norm(p.name) === key)
      ?? players.filter((p) => lastName(p.name) === key).at(0);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    else if (!hit) unmatched.push(raw);
  }
  return { ids, unmatched };
}

export function hiddenSummary(players, todayIds) {
  const hidden = players.filter((p) => !todayIds.includes(p.id));
  const flagged = hidden.filter((p) => FLAGGED.has(p.status));
  const names = flagged.map((p) => `${p.name} (${p.pos})`).join(", ");
  const text = `${hidden.length} others not listed today. ` +
    (flagged.length ? `${flagged.length} flagged: ${names}.` : "None flagged.");
  return { hiddenCount: hidden.length, flagged, text };
}

export function applyDecisions(players, decisions) {
  return players.map((p) => {
    const d = decisions[p.id];
    if (!d || d.action === "confirm") return { ...p };
    if (d.action === "remove") {
      return { ...p, status: "no_change", word: WORDS.no_change, reviewNote: `Flag removed: ${d.note}` };
    }
    return { ...p, status: d.status, word: WORDS[d.status], reviewNote: `Changed to ${WORDS[d.status]}: ${d.note}` };
  });
}

// z of 0 sits at 50%; each SD moves 15%; clamp to 2..98
export const bandPosition = (z) => Math.max(2, Math.min(98, 50 + z * 15));
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/web/*.test.mjs`
Expected: `5` tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): pure logic for lineup parsing, review decisions and hidden-player summary"
```

---

### Task 16: Theme, storage and the review screen

**Files:**
- Create: `web/css/theme.css`, `web/js/store.js`, `web/index.html`, `web/js/review.js`, `.claude/launch.json`

- [ ] **Step 1: Create `web/css/theme.css` (tokens from maurocastillomd.com `src/styles/global.css`)**

```css
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Hanken+Grotesk:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap");

:root {
  --bg: #FAFAF9; --surface: #F1F1F0; --card: #FFFFFF;
  --ink: #0B0B0C; --ink-dim: #52525B; --ink-faint: #666670;
  --accent: #2039C4; --accent-dim: #182C93; --accent-wash: rgba(32, 57, 196, 0.06);
  --line: rgba(11, 11, 12, 0.08);
  --ok: #246346; --warn: #815410; --alert: #9F3C2E;
  --display: "Fraunces", Georgia, serif;
  --sans: "Hanken Grotesk", -apple-system, system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius: 20px; --radius-sm: 12px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0E0E10; --surface: #17171A; --card: #1C1C20;
    --ink: #F4F4F5; --ink-dim: #A1A1AA; --ink-faint: #8B8B94;
    --accent: #8C9BFF; --accent-dim: #6F80F5; --accent-wash: rgba(140, 155, 255, 0.10);
    --line: rgba(255, 255, 255, 0.10);
    --ok: #6FCF9E; --warn: #E0B25C; --alert: #F08A7A;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.6 var(--sans); }
h1, h2, h3 { font-family: var(--display); font-weight: 500; line-height: 1.2; margin: 0 0 .4em; }
.mono { font-family: var(--mono); }
.wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
.fiction { font-size: 12px; color: var(--ink-faint); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; display: inline-block; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 16px; margin: 16px 0; }
button, select, textarea, input { font: inherit; color: inherit; }
button { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 6px 12px; cursor: pointer; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
textarea { width: 100%; min-height: 120px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
.word-check_in { color: var(--alert); } .word-watch { color: var(--warn); }
.word-no_change { color: var(--ink-dim); } .word-not_enough_data { color: var(--ink-faint); }
```

- [ ] **Step 2: Create `web/js/store.js`**

```js
// Review decisions live in this browser only (demo). Every access is guarded:
// private windows and blocked storage must not break the page.
const key = (date) => `lineupcard:review:${date}`;

export function loadReview(date) {
  try {
    return JSON.parse(localStorage.getItem(key(date))) ?? emptyReview();
  } catch {
    return emptyReview();
  }
}

export function saveReview(date, review) {
  try {
    localStorage.setItem(key(date), JSON.stringify(review));
    return true;
  } catch {
    return false;
  }
}

export const emptyReview = () => ({ todayIds: [], decisions: {}, approvedAt: null, reviewer: "M. Castillo" });
```

- [ ] **Step 3: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lineup Card review</title>
  <link rel="stylesheet" href="css/theme.css">
  <style>
    .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 0; border-top: 1px solid var(--line); }
    .row small { color: var(--ink-dim); display: block; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: start; }
    .err { color: var(--alert); font-size: 13px; }
    ul.plain { padding-left: 18px; margin: 0; }
  </style>
</head>
<body>
<main class="wrap">
  <span class="fiction">Fictional roster. Not a fitness-to-play decision.</span>
  <h1>Morning review</h1>
  <p>Check what the pipeline did, mark today's players, then approve the Lineup Card.</p>
  <label>Date <select id="date"></select></label>

  <section class="panel">
    <h2>1. Today's players</h2>
    <p>Paste the lineup and probable pitchers, one per line. Names, last names or IDs work.</p>
    <textarea id="lineup" aria-label="Today's players"></textarea>
    <button id="apply-lineup">Use this list</button>
    <p id="lineup-result"></p>
  </section>

  <section class="panel">
    <h2>2. What the pipeline held out or dropped</h2>
    <div id="held"></div>
    <div id="log"></div>
  </section>

  <section class="panel">
    <h2>3. Flags</h2>
    <div id="flags"></div>
  </section>

  <section class="panel">
    <button class="primary" id="approve">Approve and build the Lineup Card</button>
    <span id="approve-msg" class="err"></span>
  </section>
</main>
<script type="module" src="js/review.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `web/js/review.js`**

```js
import { FLAGGED, WORDS, parseLineup } from "./logic.js";
import { loadReview, saveReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let day, review;

async function load(date) {
  day = await (await fetch(`data/days/${date}.json`)).json();
  review = loadReview(date);
  const names = day.players.filter((p) => review.todayIds.includes(p.id)).map((p) => p.name);
  $("lineup").value = names.join("\n");
  render();
}

function render() {
  $("held").innerHTML = day.held_out.length
    ? `<h3>Not matched (held out)</h3><ul class="plain">${day.held_out.map((h) =>
        `<li>${esc(h.source)}: "${esc(h.raw)}" (${esc(h.reason)})</li>`).join("")}</ul>`
    : "<p>Every row matched a player.</p>";
  $("log").innerHTML = day.cleaning_log.length
    ? `<h3>Cleaning decisions today</h3><ul class="plain">${day.cleaning_log.map((e) =>
        `<li>${esc(e.lc_id)} · ${esc(e.source)} · ${esc(e.detail)}</li>`).join("")}</ul>`
    : "<p>No cleaning decisions today.</p>";

  const flagged = day.players.filter((p) => FLAGGED.has(p.status));
  $("flags").innerHTML = flagged.length ? flagged.map((p) => {
    const d = review.decisions[p.id];
    const state = d ? `<small>Decision: ${esc(d.action)}${d.note ? ` · ${esc(d.note)}` : ""}</small>` : "";
    return `<div class="row" data-id="${p.id}">
      <div><strong>${esc(p.name)}</strong> ${esc(p.pos)} · <span class="word-${p.status}">${esc(p.word)}</span> ${esc(p.magnitude)}
        <small>${p.reasons.map(esc).join("; ")}</small>
        <small>z gate: RSI-mod z ${p.rsi.z ?? "n/a"} · noise gate: ${p.rsi.beyond_noise === null ? "TE not yet estimated" : p.rsi.beyond_noise ? "beyond test noise" : "inside test noise"}</small>${state}
        <span class="err" data-err></span></div>
      <div class="actions">
        <button data-act="confirm">Confirm</button>
        <select data-status aria-label="New status">${Object.entries(WORDS).filter(([k]) => k !== p.status)
          .map(([k, w]) => `<option value="${k}">${w}</option>`).join("")}</select>
        <input data-note placeholder="Note (required to change or remove)" aria-label="Note">
        <button data-act="change">Change</button>
        <button data-act="remove">Remove flag</button>
      </div></div>`;
  }).join("") : "<p>No flags today.</p>";
}

$("flags").addEventListener("click", (event) => {
  const act = event.target.dataset.act;
  if (!act) return;
  const row = event.target.closest(".row");
  const note = row.querySelector("[data-note]").value.trim();
  const err = row.querySelector("[data-err]");
  if (act !== "confirm" && !note) { err.textContent = "Add a note first."; return; }
  review.decisions[row.dataset.id] = act === "change"
    ? { action: "change", status: row.querySelector("[data-status]").value, note }
    : { action: act, note };
  review.approvedAt = null;
  saveReview(day.date, review);
  render();
});

$("apply-lineup").addEventListener("click", () => {
  const { ids, unmatched } = parseLineup($("lineup").value, day.players);
  review.todayIds = ids;
  review.approvedAt = null;
  saveReview(day.date, review);
  $("lineup-result").textContent = `${ids.length} players marked for today.` +
    (unmatched.length ? ` Not found: ${unmatched.join(", ")}.` : "");
});

$("approve").addEventListener("click", () => {
  const open = day.players.filter((p) => FLAGGED.has(p.status) && !review.decisions[p.id]);
  if (!review.todayIds.length) { $("approve-msg").textContent = "Mark today's players first."; return; }
  if (open.length) { $("approve-msg").textContent = `Decide on every flag first (${open.length} left).`; return; }
  review.approvedAt = new Date().toISOString();
  saveReview(day.date, review);
  location.href = `card.html?date=${day.date}`;
});

const index = await (await fetch("data/index.json")).json();
$("date").innerHTML = index.dates.map((d) => `<option ${d === index.latest ? "selected" : ""}>${d}</option>`).join("");
$("date").addEventListener("change", (e) => load(e.target.value));
load(index.latest);
```

- [ ] **Step 5: Create `.claude/launch.json` so the preview tool can serve `web/`**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "lineup-card", "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8765", "--directory", "web"], "port": 8765 }
  ]
}
```

- [ ] **Step 6: Check it in the browser**

Start the `lineup-card` preview. Open `http://localhost:8765/`. Expected:
- 2026-09-20 is selected, "Mike Daley" appears under Not matched, and at least one cleaning decision is listed.
- J. Ortega appears under Flags with "Check in" and "beyond test noise".
- Clicking Remove flag with an empty note shows "Add a note first."
- Approving before pasting a lineup shows "Mark today's players first."
- No console errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): site theme and the morning review screen"
```

---

### Task 17: The Lineup Card page and print layout

**Files:**
- Create: `web/card.html`, `web/css/card.css`, `web/js/card.js`

- [ ] **Step 1: Create `web/card.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lineup Card</title>
  <link rel="stylesheet" href="css/theme.css">
  <link rel="stylesheet" href="css/card.css">
</head>
<body>
<main class="card wrap">
  <header class="card-head">
    <div>
      <span class="fiction">Fictional roster. Not a fitness-to-play decision.</span>
      <h1>Lineup Card</h1>
      <p id="meta" class="mono"></p>
    </div>
    <div class="head-actions noprint">
      <a href="index.html">Back to review</a>
      <button id="print">Print / PDF</button>
    </div>
  </header>
  <p id="unreviewed" class="banner" hidden>Not reviewed yet. <a href="index.html">Review first</a>.</p>
  <section><h2>Check in today</h2><ol id="checkin" class="checkin"></ol></section>
  <p id="shift" class="shift"></p>
  <section><h2>Today's players</h2>
    <div class="band-head"><span>Player</span><span>lower · his normal · higher</span><span>Status</span></div>
    <div id="today"></div>
    <p id="hidden-summary" class="hidden-summary"></p>
    <button id="toggle" class="noprint" aria-expanded="false">Show full roster</button>
    <div id="rest" hidden></div>
  </section>
  <section class="lower">
    <div><h2>Two-week trend</h2><div id="trends"></div></div>
    <div><h2>Availability board</h2><div id="board"></div></div>
  </section>
  <footer class="card-foot">
    <p>Sources: VALD ForceDecks CMJ (RSI-mod, jump height), Catapult OpenField (PlayerLoad, throws, pitches), morning wellness form. Fictional data in vendor-shaped exports.</p>
    <p>Rule: a status needs the drop to be large against his own 28-day normal and larger than the test's typical error. Position, team and league lines are context only. Coaches and medical staff decide participation.</p>
    <p id="league"></p>
    <p class="legend"><span class="sw band"></span> his normal range <span class="sw dot"></span> today, with test noise <span class="sw tick"></span> position median</p>
  </footer>
</main>
<script type="module" src="js/card.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `web/css/card.css`**

```css
.card-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
.head-actions { display: flex; gap: 12px; align-items: center; }
.head-actions a { color: var(--accent); }
.banner { background: var(--accent-wash); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
.checkin { padding-left: 20px; } .checkin li { margin: 4px 0; }
.checkin small { color: var(--ink-dim); display: block; }
.shift { font-family: var(--mono); font-size: 13px; color: var(--ink-dim); }
.band-head, .band-row { display: grid; grid-template-columns: 170px 1fr 130px; gap: 12px; align-items: center; }
.band-head { font-size: 12px; color: var(--ink-faint); border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.band-row { padding: 6px 0; border-bottom: 1px solid var(--line); }
.band-row small, .group-label { font-size: 12px; color: var(--ink-faint); }
.group-label { margin: 10px 0 0; text-transform: none; }
.track { position: relative; height: 22px; }
.track .band { position: absolute; left: 35%; width: 30%; top: 5px; height: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 3px; }
.track .tick { position: absolute; top: 1px; width: 2px; height: 20px; background: var(--ink-faint); }
.track .noise { position: absolute; top: 10px; height: 2px; background: var(--ink); opacity: .5; }
.track .dot { position: absolute; top: 6px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--ink); }
.track .none { position: absolute; left: 30%; top: 2px; font-size: 12px; color: var(--ink-faint); }
.hidden-summary { font-size: 14px; margin: 10px 0 6px; }
.lower { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
.spark { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; font-size: 13px; }
.spark svg { width: 100%; height: 34px; }
.card-foot { font-size: 11px; color: var(--ink-dim); border-top: 1px solid var(--line); margin-top: 16px; }
.legend .sw { display: inline-block; width: 18px; height: 8px; vertical-align: middle; margin: 0 4px 0 10px; }
.legend .band { background: var(--surface); border: 1px solid var(--line); }
.legend .dot { width: 8px; border-radius: 50%; background: var(--ink); }
.legend .tick { width: 2px; height: 12px; background: var(--ink-faint); }
@media (max-width: 640px) {
  .band-head, .band-row { grid-template-columns: 110px 1fr 90px; }
  .lower { grid-template-columns: 1fr; }
}
@page { size: letter; margin: 0.4in; }
@media print {
  :root { --bg: #fff; --ink: #000; --surface: #eee; }
  body { font-size: 10px; background: #fff; }
  .wrap { padding: 0; max-width: none; }
  .noprint, #rest, .banner { display: none !important; }
  h1 { font-size: 20px; } h2 { font-size: 13px; margin-top: 6px; }
  .band-row { padding: 2px 0; }
  .track { height: 16px; }
  .card { break-inside: avoid; }
}
```

- [ ] **Step 3: Create `web/js/card.js`**

```js
import { FLAGGED, applyDecisions, bandPosition, hiddenSummary } from "./logic.js";
import { loadReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GROUPS = [["SP", "Starters"], ["RP", "Relievers"], ["C", "Catchers"], ["IF", "Infield"], ["OF", "Outfield"]];

const index = await (await fetch("data/index.json")).json();
const date = new URLSearchParams(location.search).get("date") ?? index.latest;
const day = await (await fetch(`data/days/${date}.json`)).json();
let review = loadReview(date);
let example = false;
if (!review.approvedAt) {
  // A visitor with no saved review sees a bundled example review, labeled as such.
  const res = await fetch(`examples/review-${date}.json`);
  if (res.ok) { review = await res.json(); example = true; }
}
const players = applyDecisions(day.players, review.decisions);
const todayIds = review.todayIds.length ? review.todayIds : players.map((p) => p.id);

$("meta").textContent = `${day.club} · ${date} · vs ${day.schedule.opponent} (${day.schedule.home_away})` +
  (review.approvedAt ? ` · reviewed by ${review.reviewer}${example ? " (example review)" : ""}` : "");
$("unreviewed").hidden = Boolean(review.approvedAt);
$("print").addEventListener("click", () => print());

const flagged = players.filter((p) => FLAGGED.has(p.status))
  .sort((a, b) => (a.status === "check_in" ? 0 : 1) - (b.status === "check_in" ? 0 : 1) || (a.rsi.z ?? 0) - (b.rsi.z ?? 0));
$("checkin").innerHTML = flagged.length ? flagged.map((p) => `<li><strong>${esc(p.name)}</strong> ${esc(p.pos)} ·
  <span class="word-${p.status}">${esc(p.word)}</span> ${esc(p.magnitude)}
  <small>${p.reasons.map(esc).join("; ")}${p.reviewNote ? ` · ${esc(p.reviewNote)}` : ""}${pitchLine(p)}</small></li>`).join("")
  : "<li>Nobody needs a check-in today.</li>";

const shift = day.team_shift;
$("shift").textContent = shift && shift.beyond_noise
  ? `Whole roster RSI-mod ${shift.median_pct}% vs normal (n ${shift.n}).${day.schedule.note ? ` ${day.schedule.note}.` : ""}`
  : "";

const league = day.league_reference.rsi_mod;
$("league").textContent = `League context: RSI-mod ${league.value} ${league.unit} (${league.label}).`;

function pitchLine(p) {
  if (!["SP", "RP"].includes(p.pos) || p.load.throws_7d == null) return "";
  return ` · throws + pitches, last 7 days: ${p.load.throws_7d}`;
}

function row(p) {
  const z = p.rsi.z;
  const te = day.te.rsi_mod && p.rsi.sd ? day.te.rsi_mod / p.rsi.sd : null;
  const track = z == null ? `<span class="none">baseline building</span>` : `
    ${p.position_median_z == null ? "" : `<span class="tick" style="left:${bandPosition(p.position_median_z)}%" title="${p.pos} median, n ${p.position_n}"></span>`}
    ${te == null ? "" : `<span class="noise" style="left:${bandPosition(z - te)}%;width:${bandPosition(z + te) - bandPosition(z - te)}%"></span>`}
    <span class="dot" style="left:${bandPosition(z)}%"></span>`;
  return `<div class="band-row"><div>${esc(p.name)}<small>${esc(p.pos)} · RSI-mod ${p.rsi.today ?? "n/a"}</small></div>
    <div class="track"><span class="band"></span>${track}</div>
    <div><span class="word-${p.status}">${esc(p.word)}</span><small>${esc(p.magnitude)}</small></div></div>`;
}

function grouped(list) {
  return GROUPS.map(([pos, label]) => {
    const rows = list.filter((p) => p.pos === pos);
    return rows.length ? `<p class="group-label">${label}</p>${rows.map(row).join("")}` : "";
  }).join("");
}

$("today").innerHTML = grouped(players.filter((p) => todayIds.includes(p.id)));
$("rest").innerHTML = grouped(players.filter((p) => !todayIds.includes(p.id)));
const summary = hiddenSummary(players, todayIds);
$("hidden-summary").textContent = summary.hiddenCount ? summary.text : "";
$("toggle").hidden = !summary.hiddenCount;
$("toggle").addEventListener("click", () => {
  const open = $("rest").hidden;
  $("rest").hidden = !open;
  $("toggle").textContent = open ? "Hide full roster" : "Show full roster";
  $("toggle").setAttribute("aria-expanded", String(open));
});

$("trends").innerHTML = flagged.slice(0, 5).map((p) => {
  const pts = p.trend.map((t, i) => t.z == null ? null : [i * 10 + 2, 17 - Math.max(-3, Math.min(3, t.z)) * 5]);
  const path = pts.filter(Boolean).map((xy, i) => `${i ? "L" : "M"}${xy[0]},${xy[1]}`).join(" ");
  return `<div class="spark"><span>${esc(p.name)}</span><svg viewBox="0 0 134 34" role="img" aria-label="${esc(p.name)} RSI-mod z, last 14 days">
    <rect x="0" y="12" width="134" height="10" fill="var(--surface)"/><path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5"/></svg></div>`;
}).join("") || "<p>No flagged players.</p>";

try {
  const res = await fetch("figures/board/board.svg");
  if (!res.ok) throw new Error("no board");
  $("board").innerHTML = await res.text();
  for (const p of players) $("board").querySelector(`.peg[data-id="${p.id}"]`)?.setAttribute("data-status", p.status);
} catch {
  $("board").textContent = "Board figure not built yet.";
}
```

- [ ] **Step 4: Create the bundled example review `web/examples/review-2026-09-20.json`**

It sits outside `web/data/` so a rebuild never deletes it. Visitors with no saved review of their own see this, labeled "example review".
```json
{
  "todayIds": ["LC03", "LC25", "LC19", "LC20", "LC21", "LC22", "LC04", "LC26", "LC27", "LC05"],
  "decisions": {},
  "approvedAt": "2026-09-20T12:05:00Z",
  "reviewer": "M. Castillo"
}
```
After Task 14 builds the data, open `web/data/days/2026-09-20.json` and add a `{"action": "confirm"}` decision for every player whose `status` is `check_in` or `watch`, keyed by ID. Use `"confirm"` for all but one Watch player. Give that one `{"action": "change", "status": "no_change", "note": "Tested 20 minutes after treatment; retest tomorrow"}`, so the example shows a reviewer override.

- [ ] **Step 5: Check it in the browser**

With the preview running, approve 2026-09-20 in the review screen, pasting this lineup:
```
T. Brandt
Serrano
Thorne
Quintero
Mabry
Novak
Daley
Gallagher
Achebe
A. Whitcomb
```
Expected on `card.html?date=2026-09-20`:
- Ortega is in "Check in today" with his reason and his 7-day throw total.
- "Today's players" shows 10 rows, grouped by role.
- The summary line names Ortega among the flagged hidden players.
- "Show full roster" reveals the rest.
- No console errors.

Repeat at 390 px wide: no horizontal scroll.

- [ ] **Step 6: Print check (one page)**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --print-to-pdf=/tmp/lineup-card.pdf --no-pdf-header-footer \
  "http://localhost:8765/card.html?date=2026-09-20"
python3 -c "import re;d=open('/tmp/lineup-card.pdf','rb').read();print('pages:',len(re.findall(rb'/Type\s*/Page[^s]',d)))"
```
Expected: `pages: 1`. If it is 2, tighten print sizes in `card.css` (row padding, font size, trend count) until it is 1. Headless Chrome has no saved review, so it prints the example review. Also print `card.html?date=2026-09-19`, which has no example review and so shows all 28 players: the worst case for length. It must also be 1 page.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): the Lineup Card with band rows, roster toggle and one-page print"
```

---

### Task 18: Anatomy availability board

**REQUIRED SKILL:** load `anatomy` before this task and follow its workflow (truth first, parts list, plan the world, build once, painter's order, frame, verify). Size: Figure (40 to 80 parts beyond the repeated pegs).

**Files:**
- Create: `web/figures/board/vendor/iso-kit.mjs`, `web/figures/board/vendor/LICENSE`, `web/figures/board/build.mjs`, `web/figures/board/board.svg` (built output)
- Modify: `web/css/card.css` (status rules for tags)

**Contract the card depends on (must hold exactly):**
- `build.mjs` reads `../../data/days/<latest>.json` (via `../../data/index.json`) for the 28 player IDs, names and positions, and writes `board.svg` next to itself, light theme, using `figureSvg({ standalone: "light" })`.
- One group per player: `<g class="peg" data-id="LC01" data-status="no_change">`.
- Inside each peg, four tag variants: `<g class="tag" data-for="check_in">`, `watch`, `no_change`, `not_enough_data`. Each tag is a small hanging plate with an engraved glyph (check in: two bars; watch: one bar; no change: a ring; not enough data: a dashed ring). No words inside the drawing, apart from at most one tiny engraved label on the board's nameplate.
- Each peg group gets a `<title>` with "Name · Position" for hover.
- Pegs are arranged in five rails, one per role in the order SP, RP, C, IF, OF.

**Object and parts list (write this into `build.mjs` as a comment before any geometry):**
- Base: wall bracket plate, two corner screws per bracket (4 brackets), halo under the board.
- Structure: board slab with bevel, inset groove, five rails (raised strips) with end stops, a ruler strip along the bottom with ticks every 4 units, a major every 5th.
- Mechanism: 28 pegs (cylinder + knurled cap), each with a hanging tag on a short ring.
- Controls: a header nameplate with three rule lines, a small key rack at the right end with four sample tags (the legend in object form).
- Subject: the tags. The `check_in` tags are the single `lit` accent.

- [ ] **Step 1: Vendor the kit**

```bash
mkdir -p web/figures/board/vendor
cp ~/.claude/skills/anatomy/kit/iso-kit.mjs web/figures/board/vendor/
cp ~/.claude/skills/anatomy/LICENSE web/figures/board/vendor/LICENSE
```

- [ ] **Step 2: Write `build.mjs` following the skill and the contract above, then build**

Run: `node web/figures/board/build.mjs`
Expected: prints the path of `board.svg`, and the file contains 28 `class="peg"` groups:
```bash
grep -o 'class="peg"' web/figures/board/board.svg | wc -l
```
Expected: `28`.

- [ ] **Step 3: Add the tag rules to `web/css/card.css`**

```css
#board svg { width: 100%; height: auto; }
#board .tag { display: none; }
#board .peg[data-status="check_in"] .tag[data-for="check_in"],
#board .peg[data-status="watch"] .tag[data-for="watch"],
#board .peg[data-status="no_change"] .tag[data-for="no_change"],
#board .peg[data-status="not_enough_data"] .tag[data-for="not_enough_data"] { display: inline; }
```

- [ ] **Step 4: Verify like the skill says**

- Capture the card at desktop and at 390 px with the skill's `scripts/capture.mjs`, and read the PNGs.
- Zoom to 4x on the rails, pegs and tags. Every line must end on something, with no bare faces.
- Check that Ortega's peg shows the check-in tag and Ruiz's shows not enough data.
- Rerun the one-page print check from Task 17, Step 6. Expected: `pages: 1`.

- [ ] **Step 5: Export a JPEG for Mauro (his standing rule for every figure)**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --screenshot=/tmp/board.png --window-size=1200,700 "http://localhost:8765/figures/board/board.svg"
sips -s format jpeg /tmp/board.png --out ~/lineup-card/docs/availability-board.jpg
```
Send `docs/availability-board.jpg` to Mauro.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(figure): anatomy availability board with one peg per player"
```

---

### Task 19: README with checked citations and the schedule

**Files:**
- Create: `README.md`

- [ ] **Step 1: Verify every citation in the spec's "Citations to verify" list**

For each one, search the DOI or the title. Keep it only if the authors, year, journal and DOI all match. Drop Buchheit 2017 and Ward 2019 unless an exact source is found. Write down which ones were kept.

- [ ] **Step 2: Write `README.md` with these sections, in this order**

1. Title and one line: "A daily one-page staff report from force plate, GPS and wellness data, with the coach's review before anything is shared."
2. The fictional label (bold) and "Not a fitness-to-play decision."
3. "What it does": collect, clean, flag, review, card. One plain sentence each.
4. "The rules": the two gates, the four status words, and context frames that never set a status. Plain language, numbers included (28 days, 10 readings, z -1.2 and -2.0, TE = SD of differences / sqrt 2, trials more than 10% from the median dropped).
5. "Run it" with exact commands:
   ```bash
   python3 -m venv .venv
   .venv/bin/python -m pip install -e '.[dev]'
   .venv/bin/python scripts/generate_fictional.py
   .venv/bin/python scripts/build_site.py
   python3 -m http.server 8765 --directory web
   ```
   Then: "Open http://localhost:8765, mark today's players, decide on each flag, approve."
6. "Run it every morning": a crontab line, documented and not installed:
   `0 7 * * * cd ~/lineup-card && .venv/bin/python scripts/build_site.py`
7. "Real data": the export column names are modeled on public examples; live VALD or Catapult connections need a club account (see `adapters/api_stub.py`); never put real athlete data in a public repo.
8. "Built on Readiness" with commit `09435aa`.
9. "Evidence" with only the verified citations.
10. "Tests": `.venv/bin/python -m pytest -q` and `node --test tests/web/*.test.mjs`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README with rules, run steps, schedule and verified citations"
```

---

### Task 20: Final verification

- [ ] **Step 1: Full test run**

```bash
.venv/bin/python -m pytest -q
node --test tests/web/*.test.mjs
```
Expected: every test passes. Record the counts.

- [ ] **Step 2: Clean rebuild from nothing**

```bash
rm -rf data/fictional web/data
.venv/bin/python scripts/generate_fictional.py
.venv/bin/python scripts/build_site.py
git status --short
```
Expected: `git status` shows no changes (the generator is deterministic).

- [ ] **Step 3: Browser pass**

Review and card, at desktop and at 390 px, in light and dark. Run the full review flow on 2026-09-15 (travel day: the team-shift line shows) and on 2026-09-20. No console errors.

- [ ] **Step 4: PDF and stills for Mauro**

Print `card.html?date=2026-09-20` with headless Chrome (it uses the example review) to `docs/lineup-card-2026-09-20.pdf`. Export page 1 as a JPEG with `sips -s format jpeg`, and send both to Mauro.

- [ ] **Step 5: Update Mauro's state file**

Add the result to `~/claude-projects/mauro-context/CURRENT_STATE.md` under "Lineup Card": commit hash, test counts, what was verified, and "not published".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verification artifacts for 2026-09-20"
```

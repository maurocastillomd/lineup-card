// The deterministic core. All math lives here. No AI anywhere in this file.
//
// Rules (plain English, because a coach has to trust them):
//
//   Baseline     Each response metric is measured against the athlete's OWN
//                28-day rolling baseline (min 10 readings). Direction is
//                sign-normalized to a "goodness" scale so a decline is always
//                a negative z and one threshold set serves every domain.
//
//   Per domain   REVIEW z <= -2.0; MONITOR z <= -1.2 or 3+ consecutive
//                declines past the smallest worthwhile change (0.2 x SD);
//                else within range when assessable; missing data stays explicit.
//
//   Convergence  Athlete status escalates on agreement: REVIEW if any domain
//                is REVIEW, or if >= 2 assessable domains sit at/under -1.2.
//                Else MONITOR if any domain is MONITOR. Else within range only
//                when all response domains are assessable; otherwise insufficient.
//
//   Context      Jump height, PlayerLoad, throws and pitches come along as
//                CONTEXT. They never set a status.
//
//   Noise gate   A flag also needs the drop from baseline to exceed 1.5 x
//                the metric's typical error (TE, Hopkins 2000), estimated
//                from the squad's own repeat readings. A big z inside that
//                band is "No change". Unknown TE never blocks a flag; the reason
//                says the noise is not yet estimated.
//
//   Freshness    Streams arrive on different clocks. A domain is assessed
//                from its most recent reading within FRESHNESS_DAYS; with no
//                fresh reading it is "insufficient data" and never flags.
//
// Nothing here predicts injury. It surfaces individual change in readiness.
//
// Ported from src/lineup_card/engine.py. Same arithmetic order as Python, so the
// numbers match to the last digit. Days are ISO strings, compared with < and <=.

import { addDays } from "./dates.mjs";
import { fmean, pyFixed, pyG, pyRound, stdev } from "./pymath.mjs";

export const BASELINE_DAYS = 28;
export const MIN_BASELINE_SESSIONS = 10;
export const FRESHNESS_DAYS = 4;
export const LOAD_DAYS = 7;
export const NOISE_GATE_MULTIPLIER = 1.5;
export const REVIEW_Z = -2.0;
export const MONITOR_Z = -1.2;
export const CONVERGENCE_Z = -1.2;
export const MONITOR_DECLINE_SESSIONS = 3;
export const TREND_SESSIONS = 14;
export const SWC_FACTOR = 0.2;

export const SEVERITY = { review: 0, monitor: 1, insufficient_data: 2, cleared: 3 };

export const METRICS = {
  perceptual: { domain: "perceptual", column: "wellness_score", label: "Wellness", unit: "pts", higher_is_worse: false, rolling_days: 1 },
  neuromuscular: { domain: "neuromuscular", column: "rsi_mod", label: "RSI-mod", unit: "m/s", higher_is_worse: false, rolling_days: 1 },
};
export const METRIC_ORDER = ["perceptual", "neuromuscular"];   // Python dict order of METRICS

// context metrics: shown on the card, never set a status
export const JUMP_HEIGHT = "jump_height_cm";
export const PLAYER_LOAD = "player_load";
export const THROWS = "throw_count";
export const PITCHES = "pitch_count";

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

// Trailing calendar mean, emitted only for complete daily windows.
export function rolling(points, days) {
  if (days <= 1) return [...points];
  const out = [];
  points.forEach(([d], i) => {
    const lo = addDays(d, -(days - 1));
    const window = points.slice(0, i + 1).filter(([dd]) => lo <= dd && dd <= d).map(([, v]) => v);
    if (window.length === days) out.push([d, fmean(window)]);
  });
  return out;
}

export function countConsecutiveDeclines(values) {
  let run = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i] < values[i - 1]) run += 1;
    else break;
  }
  return run;
}

// The smallest drop (raw units) that counts as more than test noise.
// te is the typical error: SD of day-to-day differences / sqrt(2).
// For reference: 1 x TE is the loosest common rule; MDC95 is
// 1.96 x sqrt(2) x TE, about 2.77 x TE, the strictest.
// Rule chosen by Mauro Castillo, 2026-10-21: 1.5 x TE. A middle ground for a
// daily report: fewer false alarms than 1 x TE, far fewer missed declines
// than MDC95. No validated cutoff exists for pro baseball CMJ.
export const noiseThreshold = (te) => NOISE_GATE_MULTIPLIER * te;

// sorted() on (day, value) tuples
const byDayThenValue = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

// A DomainAssessment with the pydantic model's fields, in its field order.
function domainAssessment(f) {
  return {
    domain: f.domain, status: f.status, fresh: f.fresh, observed_on: f.observed_on ?? null,
    today: f.today, base: f.base, pct: f.pct, decline_z: f.decline_z,
    consecutive_declines: f.consecutive_declines ?? 0, te: f.te ?? null,
    beyond_noise: f.beyond_noise ?? null, reasons: f.reasons ?? [],
  };
}

export const assessable = (d) => d.fresh && d.decline_z !== null;

// Assess one response domain from its raw [day, value] series.
export function assessDomain(spec, points, today, te = null) {
  const pts = points.filter(([d]) => d <= today).map(([d, v]) => [d, v]).sort(byDayThenValue);
  if (new Set(pts.map(([d]) => d)).size !== pts.length) {
    throw new Error("Multiple values for one metric-day need explicit aggregation");
  }
  if (!pts.every(([, v]) => Number.isFinite(v))) throw new Error("Response values must be finite");
  const rolled = rolling(pts, spec.rolling_days);
  const freshFrom = addDays(today, -FRESHNESS_DAYS);
  const freshPts = rolled.filter(([d]) => freshFrom <= d && d <= today);
  if (!freshPts.length) {
    const latest = pts.length ? pts[pts.length - 1][0] : null;
    return domainAssessment({
      domain: spec.domain, status: "insufficient_data", fresh: false, today: null, base: null, pct: null,
      decline_z: null, observed_on: latest, reasons: ["no current complete measurement"],
    });
  }
  const [todayDay, todayVal] = freshPts[freshPts.length - 1];
  const windowStart = addDays(todayDay, -BASELINE_DAYS);
  const prior = rolled.filter(([d]) => windowStart <= d && d < todayDay).map(([, v]) => v);
  const gPrior = prior.map((v) => goodness(v, spec.higher_is_worse));
  const base = computeBaseline(gPrior);
  if (base === null) {
    return domainAssessment({
      domain: spec.domain, status: "insufficient_data", fresh: true, today: pyRound(todayVal, 2), base: null,
      pct: null, decline_z: null, observed_on: todayDay,
      reasons: [prior.length < MIN_BASELINE_SESSIONS ? "baseline-building" : "baseline has no usable variation"],
    });
  }
  const gToday = goodness(todayVal, spec.higher_is_worse);
  const declineZ = zScore(gToday, base);
  const recent = [...gPrior, gToday].slice(-TREND_SESSIONS);
  const declines = countConsecutiveDeclines(recent);
  const cumulativeDrop = declines ? recent[recent.length - 1 - declines] - recent[recent.length - 1] : 0.0;

  const drop = base.mean - gToday;          // goodness units; positive means worse
  const beyondNoise = te === null || te === undefined ? null : drop > noiseThreshold(te);

  let reasons = [];
  let status;
  if (declineZ <= REVIEW_Z) {
    status = "review";
    reasons.push(`${spec.label} ${pyFixed(Math.abs(declineZ), 1)} SD below his 28-day normal`);
  } else if (declineZ <= MONITOR_Z) {
    status = "monitor";
    reasons.push(`${spec.label} ${pyFixed(Math.abs(declineZ), 1)} SD below his 28-day normal`);
  } else if (declines >= MONITOR_DECLINE_SESSIONS && cumulativeDrop > base.swc) {
    status = "monitor";
    reasons.push(`${spec.label}: ${declines} declining readings in a row`);
  } else {
    status = "cleared";
  }

  if (status === "review" || status === "monitor") {
    if (beyondNoise === false) {
      status = "cleared";
      reasons = [`${spec.label} drop inside test noise (TE ${pyG(te)} ${spec.unit})`];
    } else if (beyondNoise === true) {
      reasons[reasons.length - 1] += " and beyond test noise";
    } else {
      reasons[reasons.length - 1] += "; test noise not yet estimated";
    }
  }

  const rawMean = spec.higher_is_worse ? -base.mean : base.mean;
  const pct = rawMean === 0 ? null : pyRound((todayVal - rawMean) / rawMean * 100.0, 1);
  return domainAssessment({
    domain: spec.domain, status, fresh: true, today: pyRound(todayVal, 3), base, pct,
    decline_z: declineZ, observed_on: todayDay, consecutive_declines: declines, reasons,
    te: te ?? null, beyond_noise: beyondNoise,
  });
}

export function metricSeries(readings, metric, today) {
  const byDay = new Map();
  for (const r of readings) {
    if (r.metric === metric && r.day <= today) {
      if (byDay.has(r.day) && byDay.get(r.day) !== r.value) {
        throw new Error("Conflicting values for one athlete, metric and day; " +
          "resolve source priority or aggregate before assessment");
      }
      byDay.set(r.day, r.value);
    }
  }
  return [...byDay.entries()].sort(byDayThenValue);
}

const intOrNone = (v) => (v === null ? null : pyRound(v, 0));

// Catapult workload. CONTEXT only; never sets a status.
export function loadContext(readings, today) {
  const on = (metric, day) => {
    const vals = readings.filter((r) => r.metric === metric && r.day === day).map((r) => r.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const from = addDays(today, -(LOAD_DAYS - 1));
  const window = readings.filter((r) => (r.metric === THROWS || r.metric === PITCHES) && from <= r.day && r.day <= today);
  return {
    player_load_today: on(PLAYER_LOAD, today),
    throws_today: intOrNone(on(THROWS, today)),
    pitches_today: intOrNone(on(PITCHES, today)),
    throws_7d: window.length ? intOrNone(window.reduce((a, r) => a + r.value, 0)) : null,
  };
}

// Assess one athlete across response domains; status by convergence.
// Retain known athletes with insufficient data; null for no as-of identity.
export function assessAthlete(readings, today, te = null) {
  readings = readings.filter((r) => r.day <= today);
  const identities = new Set(readings.map((r) => JSON.stringify([r.athlete_id, r.name])));
  if (identities.size > 1) throw new Error("Conflicting athlete identities; resolve the roster before assessment");
  // sorted(..., reverse=True) is stable: the first reading of the latest day wins.
  let ident = null;
  for (const r of readings) {
    if (ident === null || r.day > ident[3]) ident = [r.athlete_id, r.name, r.pos, r.day];
  }
  if (ident === null) return null;

  te = te || {};
  const domains = METRIC_ORDER.map((key) => {
    const spec = METRICS[key];
    const series = metricSeries(readings, spec.column, today);
    return assessDomain(spec, series, today, te[spec.column] ?? null);
  });

  const ok = domains.filter(assessable);
  const anyReview = domains.some((d) => d.status === "review");
  const converging = ok.filter((d) => d.decline_z <= CONVERGENCE_Z && d.beyond_noise !== false);
  let status;
  if (anyReview || converging.length >= 2) status = "review";
  else if (domains.some((d) => d.status === "monitor")) status = "monitor";
  else if (ok.length === METRIC_ORDER.length) status = "cleared";
  else status = "insufficient_data";

  const flagged = domains.filter((d) => d.status === "review" || d.status === "monitor")
    .sort((a, b) => (SEVERITY[a.status] - SEVERITY[b.status]) || (a.decline_z < b.decline_z ? -1 : a.decline_z > b.decline_z ? 1 : 0));
  const drivers = flagged.map((d) => d.domain);
  const reasons = flagged.flatMap((d) => d.reasons);
  if (converging.length >= 2) {
    reasons.unshift(`${converging.length} response domains at or below z ${pyFixed(CONVERGENCE_Z, 1)}; convergence review rule`);
  }
  if (ok.length < METRIC_ORDER.length) reasons.push("Incomplete response-domain coverage; check missing or stale data");

  const load = loadContext(readings, today);

  const [aid, name, pos] = ident;
  return { athlete_id: aid, name, pos, status, domains, drivers, load, reasons };
}

function worstZ(a) {
  const zs = a.domains.map((d) => d.decline_z).filter((z) => z !== null);
  return zs.length ? Math.min(...zs) : 0.0;
}

// Assess every athlete with data. Sorted worst-first.
export function assessSquad(readings, today, te = null) {
  const byAthlete = new Map();
  for (const r of readings) {
    if (!byAthlete.has(r.athlete_id)) byAthlete.set(r.athlete_id, []);
    byAthlete.get(r.athlete_id).push(r);
  }
  const out = [];
  for (const group of byAthlete.values()) {
    const a = assessAthlete(group, today, te);
    if (a !== null) out.push(a);
  }
  return out.sort((a, b) => {
    const s = SEVERITY[a.status] - SEVERITY[b.status];
    if (s) return s;
    const za = worstZ(a), zb = worstZ(b);
    return za < zb ? -1 : za > zb ? 1 : 0;
  });
}

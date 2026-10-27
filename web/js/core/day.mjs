// Build one day's JSON for the web app. Every number the card shows is
// computed here; the page only displays it.
//
// Ported from src/lineup_card/day.py. Same keys, same rounding, same order.

import { addDays, daysBetween } from "./dates.mjs";
import {
  JUMP_HEIGHT, METRICS, METRIC_ORDER, MONITOR_Z, assessSquad, computeBaseline, goodness, loadContext,
  noiseThreshold, zScore,
} from "./engine.mjs";
import { LEAGUE_REFERENCE, MDC95_FACTOR, positionMedians, teamShift, testSensitivity, typicalError } from "./frames.mjs";
import { cmpTuple, pyRound } from "./pymath.mjs";

export const CLUB = "Fictional Triple-A Club";
export const TREND_DAYS = 14;
export const STATUS_WORDS = {
  review: ["check_in", "Check in"],
  monitor: ["watch", "Watch"],
  cleared: ["no_change", "No change"],
  insufficient_data: ["not_enough_data", "Not enough data"],
};

export function magnitude(z) {
  if (z === null) return "";
  if (z <= -2.0) return "▼ large";
  if (z <= -1.2) return "▼ moderate";
  return "– within noise";
}

export const DOMAIN_NAMES = { neuromuscular: "jump", perceptual: "wellness" };

// Size of the change that set the status, named when it is not the jump.
export function driverMagnitude(domains) {
  const flagged = domains.filter((d) => d.status === "review" || d.status === "monitor");
  if (!flagged.length) return domains.every((d) => d.decline_z === null) ? "" : "– within noise";
  // min() keeps the first of equal values
  const worst = flagged.reduce((w, d) => (d.decline_z < w.decline_z ? d : w));
  // A Watch from 3 declines in a row can sit above the -1.2 z line; do not call it "within noise".
  const size = worst.decline_z > MONITOR_Z ? "▼ steady decline" : magnitude(worst.decline_z);
  return worst.domain === "neuromuscular" ? size : `${size} (${DOMAIN_NAMES[worst.domain]})`;
}

// observed_on / days_old say which day the reading is from, so a jump a few
// days old is never shown as today's. Both null when there is no reading.
export function domainJson(d, today, te) {
  const when = {
    observed_on: d.observed_on ?? null,
    days_old: d.observed_on == null ? null : daysBetween(d.observed_on, today),
  };
  if (d.base === null) {
    return { today: d.today, mean: null, sd: null, z: null, pct: null, beyond_noise: null, ...when };
  }
  const change = pyRound(d.today - d.base.mean, 4);        // both domains: higher is better
  return {
    today: d.today, mean: pyRound(d.base.mean, 3), sd: pyRound(d.base.sd, 3),
    z: pyRound(d.decline_z, 2), pct: d.pct, beyond_noise: d.beyond_noise,
    change,
    change_te: !te ? null : pyRound(change / te, 1),
    beyond_mdc: !te ? null : change < -pyRound(MDC95_FACTOR * te, 4),
    swc_personal: pyRound(d.base.swc, 4),     // 0.2 x HIS SD (trend rule), not Hopkins' SWC
    ...when,
  };
}


// Daily RSI-mod z vs the baseline that applied on each day.
export function trend(readings, lcId, today) {
  const spec = METRICS.neuromuscular;
  const series = readings.filter((r) => r.athlete_id === lcId && r.metric === spec.column)
    .map((r) => [r.day, r.value]).sort(cmpTuple);
  const out = [];
  for (let offset = TREND_DAYS - 1; offset >= 0; offset--) {
    const day = addDays(today, -offset);
    const hit = series.find(([d]) => d === day);
    const value = hit ? hit[1] : null;
    const from = addDays(day, -28);
    const prior = series.filter(([d]) => from <= d && d < day).map(([, v]) => v);
    const base = computeBaseline(prior.map((v) => goodness(v, spec.higher_is_worse)));
    const z = value === null || base === null ? null : pyRound(zScore(value, base), 2);
    out.push({ date: day, z });
  }
  return out;
}

export function latest(readings, lcId, metric, today) {
  const r = readings.find((x) => x.athlete_id === lcId && x.metric === metric && x.day === today);
  return r ? pyRound(r.value, 1) : null;
}

// On a team-shift day: did he drop more than the team, by more than noise?
// Context only. null when there is no team shift or no reading today.
export function beyondTeam(d, shift, te, today) {
  if (!shift || !shift.beyond_noise || te === null) return null;
  if (d.base === null || d.observed_on !== today) return null;
  if (d.decline_z === null || d.decline_z > MONITOR_Z) return null;   // his jump is not down
  return (d.today - d.base.mean) - shift.median_raw < -noiseThreshold(te);
}

// club: { name, synthetic }. sources: the pull status for today, added only when there is one.
export function buildDay(readings, today, cw, log, schedule, club = null, sources = null) {
  club = club || { name: CLUB, synthetic: true };
  const specs = METRIC_ORDER.map((k) => METRICS[k]);
  const te = {};
  for (const spec of specs) te[spec.column] = typicalError(readings, spec.column, today);
  const assessed = assessSquad(readings, today, te);

  const rsiById = new Map(assessed.map((a) => [a.athlete_id, a.domains.find((d) => d.domain === "neuromuscular")]));
  const zById = new Map([...rsiById].filter(([, d]) => d.decline_z !== null).map(([k, d]) => [k, d.decline_z]));
  const medians = positionMedians(zById, new Map(assessed.map((a) => [a.athlete_id, a.pos])));
  const tested = [...rsiById.values()].filter((d) => d.base !== null && d.observed_on === today);
  const shift = teamShift(tested.map((d) => d.today - d.base.mean),
    tested.filter((d) => d.pct !== null).map((d) => d.pct), te.rsi_mod);

  const players = assessed.map((a) => {
    const [status, word] = STATUS_WORDS[a.status];
    const rsi = rsiById.get(a.athlete_id);
    const well = a.domains.find((d) => d.domain === "perceptual");
    const group = medians[a.pos] ?? { median_z: null, n: 0 };
    return {
      id: a.athlete_id, name: a.name, pos: a.pos,
      status, word, magnitude: driverMagnitude(a.domains),
      reasons: a.reasons.length ? a.reasons : a.domains.flatMap((d) => d.reasons),
      rsi: domainJson(rsi, today, te.rsi_mod),
      wellness: domainJson(well, today, te.wellness_score),
      jump_height_cm: latest(readings, a.athlete_id, JUMP_HEIGHT, today),
      position_median_z: group.median_z, position_n: group.n,
      // Morning card: load runs through yesterday so tonight's game is not counted.
      load: loadContext(readings.filter((r) => r.athlete_id === a.athlete_id), addDays(today, -1)),
      beyond_team: beyondTeam(rsi, shift, te.rsi_mod, today),
      trend: trend(readings, a.athlete_id, today),
    };
  });

  const noiseGate = {};
  const signal = {};
  for (const spec of specs) {
    const v = te[spec.column];
    noiseGate[spec.column] = v === null ? null : pyRound(noiseThreshold(v), 4);
    const means = assessed.flatMap((a) => a.domains.filter((d) => d.domain === spec.domain && d.base !== null).map((d) => d.base.mean));
    signal[spec.column] = testSensitivity(means, v);
  }

  const out = {
    date: today, synthetic: club.synthetic, club: club.name,
    schedule,
    te,
    noise_gate: noiseGate,
    signal,
    team_shift: shift, league_reference: LEAGUE_REFERENCE,
    players,
    held_out: log.held_out,
    cleaning_log: log.entries.filter((e) => e.day === today).map(({ lc_id, day, source, rule, detail }) => ({ lc_id, day, source, rule, detail })),
  };
  if (sources) out.sources = sources;
  return out;
}

// Context frames. None of these ever set a status.
//
//   Typical error  Pooled across the squad from each player's consecutive
//                  readings in the 28 days before today:
//                  TE = SD(differences) / sqrt(2)  (Hopkins 2000).
//   Position       Median of today's z by role, with n. Groups are small at
//                  Triple-A, so a median, and n is always shown.
//   Team           Median of today's raw change vs each player's normal.
//                  Beyond noise only when the median is a DROP (below zero)
//                  and its size exceeds 1.5 x TE. A team-wide rise is not a
//                  team-shift day.
//   League         One illustrative value per metric. No public MiLB VALD
//                  norm exists; the label says so.
//
// Ported from src/lineup_card/frames.py.

import { addDays } from "./dates.mjs";
import { noiseThreshold } from "./engine.mjs";
import { fmean, median, pyRound, stdev } from "./pymath.mjs";

export const BASELINE_DAYS = 28;
export const MIN_PAIRS = 10;

export const LEAGUE_REFERENCE = {
  rsi_mod: { value: 0.52, unit: "m/s", label: "illustrative, not a published MLB or MiLB norm" },
  jump_height_cm: { value: 42.0, unit: "cm", label: "illustrative, not a published MLB or MiLB norm" },
};

const byDayThenValue = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const entries = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m));
const lookup = (m, k) => (m instanceof Map ? m.get(k) : m[k]);

export function typicalError(readings, metric, today) {
  const start = addDays(today, -BASELINE_DAYS);
  const byAthlete = new Map();
  for (const r of readings) {
    if (r.metric === metric && start <= r.day && r.day < today) {
      if (!byAthlete.has(r.athlete_id)) byAthlete.set(r.athlete_id, []);
      byAthlete.get(r.athlete_id).push([r.day, r.value]);
    }
  }
  const diffs = [];
  for (const points of byAthlete.values()) {
    const values = [...points].sort(byDayThenValue).map(([, v]) => v);
    for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  }
  if (diffs.length < MIN_PAIRS) return null;
  return pyRound(stdev(diffs) / 2 ** 0.5, 4);
}

// zById, posById: Map or plain object. Groups keep first-seen order of zById.
export function positionMedians(zById, posById) {
  const groups = new Map();
  for (const [id, z] of entries(zById)) {
    const pos = lookup(posById, id);
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push(z);
  }
  const out = {};
  for (const [pos, zs] of groups) out[pos] = { median_z: pyRound(median(zs), 2), n: zs.length };
  return out;
}

export function teamShift(rawChanges, pctChanges, te) {
  if (!rawChanges.length) return null;
  const medianRaw = median(rawChanges);
  return {
    median_pct: pyRound(median(pctChanges), 1),
    median_raw: pyRound(medianRaw, 4),
    beyond_noise: te !== null && te !== undefined && medianRaw < 0 && Math.abs(medianRaw) > noiseThreshold(te),
    n: rawChanges.length,
  };
}

export const MDC95_FACTOR = 1.96 * 2 ** 0.5;   // 95% minimal detectable change = 1.96 x sqrt(2) x TE

// How sensitive is this test for this squad? (Hopkins 2000)
// SWC is 0.2 x the between-player SD of each player's normal. When TE is
// bigger than SWC, one reading cannot settle a change that small. Rating
// bands (a convention): SWC/TE >= 1 good, >= 0.5 OK, below 0.5 marginal.
export function testSensitivity(playerMeans, te) {
  if (te === null || te === undefined || playerMeans.length < 2) return null;
  const grandMean = fmean(playerMeans);
  const betweenSd = stdev(playerMeans);
  const swc = 0.2 * betweenSd;
  const ratio = swc / te;
  return {
    n: playerMeans.length,
    grand_mean: pyRound(grandMean, 4),
    between_sd: pyRound(betweenSd, 4),
    te,
    cv_pct: pyRound(te / grandMean * 100, 1),
    swc: pyRound(swc, 4),
    swc_te: pyRound(ratio, 2),
    mdc95: pyRound(MDC95_FACTOR * te, 4),
    gate: pyRound(noiseThreshold(te), 4),
    rating: ratio >= 1 ? "good" : ratio >= 0.5 ? "OK" : "marginal",
  };
}

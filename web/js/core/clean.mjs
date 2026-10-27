// Cleaning rules, ported from src/lineup_card/clean.py. Every decision goes in
// the CleanLog so the coach sees it on the review screen.

import { cmpTuple, fmean, median, pyFixed } from "./pymath.mjs";

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

// Same checks as the pydantic Reading: text is stripped, then length-checked
// (code points, like Python); the metric must be known; the value finite and not negative.
function checkedText(label, s, max) {
  const t = String(s).trim();
  const n = [...t].length;
  if (n < 1 || n > max) throw new Error(`Reading ${label} must be 1 to ${max} characters`);
  return t;
}

export function makeReading(cw, lc_id, day, metric, value, source) {
  const p = cw.player(lc_id);
  const r = {
    athlete_id: checkedText("athlete_id", lc_id, 200), name: checkedText("name", p.name, 200), pos: checkedText("pos", p.pos, 100),
    day, metric: String(metric).trim(), value, source: checkedText("source", source, 200),
  };
  if (!METRIC_NAMES.has(r.metric)) throw new Error("Unknown metric; map export columns to an engine metric");
  if (!Number.isFinite(value)) throw new Error("Reading values must be finite");
  if (value < 0) throw new Error("This metric cannot be negative");
  return r;
}

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
  for (const { id, day, group } of [...groups.values()].sort((a, b) => cmpTuple([a.id, a.day], [b.id, b.day]))) {
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
  return [...sums.values()].sort((a, b) => cmpTuple([a.id, a.day, a.metric], [b.id, b.day, b.metric]))
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

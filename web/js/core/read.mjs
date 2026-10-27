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

// A short row gives null cells (Python: None). Python then fails on .strip(); here
// the error names the column. Catapult's number cells are the one place Python
// tolerates None.
const text = (row, col) => {
  if (row[col] == null) throw new Error(`a row has no value for column '${col}'`);
  return row[col].trim();
};
const num = (cell) => { const s = (cell ?? "").trim(); return s ? pyFloat(s) : null; };

// ---- vald.py ----
export function readVald({ headers, rows }) {
  const missing = missingCols(headers, ["Name", "ExternalId", "Date", "Test Type", "Trial"]);
  if (missing.length) throw new Error("VALD export is missing columns: " + missing.join(", "));
  const jump = findColumn(headers, "Jump Height (Imp-Mom)", "cm");
  const rsi = findColumn(headers, "RSI-modified", "m/s");
  return rows.filter((r) => text(r, "Test Type").toUpperCase() === "CMJ").map((r) => ({
    name: text(r, "Name"), external_id: text(r, "ExternalId"), day: isoDate(text(r, "Date")),
    trial: pyInt(text(r, "Trial")), jump_height_cm: num(text(r, jump)), rsi_mod: num(text(r, rsi)),
  }));
}

// ---- catapult.py ----
const CATAPULT = ["player_name", "period_name", "period_number", "start_time", "player_load", "throw_count", "pitch_count"];
export function readCatapult({ headers, rows }) {
  const missing = missingCols(headers, CATAPULT);
  if (missing.length) throw new Error("Catapult export is missing columns: " + missing.join(", "));
  const int = (cell) => {   // Python int(float): truncates; inf raises
    const v = num(cell);
    if (v !== null && !Number.isFinite(v)) throw new Error(`cannot convert '${cell}' to a whole number`);
    return v === null ? null : Math.trunc(v);
  };
  return rows.map((r) => ({
    player_name: text(r, "player_name"), period_name: text(r, "period_name"),
    period_number: pyInt(text(r, "period_number")), day: localDayChicago(text(r, "start_time")),
    player_load: num(r.player_load), throw_count: int(r.throw_count), pitch_count: int(r.pitch_count),
  }));
}

// ---- wellness.py ----
const ITEMS = ["sleep_quality", "soreness", "fatigue", "stress", "mood"];
export function readWellness({ headers, rows }) {
  const missing = missingCols(headers, ["athlete_id", "date", ...ITEMS]);
  if (missing.length) throw new Error("Wellness file is missing columns: " + missing.join(", "));
  return rows.map((r) => {
    const cells = ITEMS.map((i) => text(r, i));
    let score = null;
    if (cells.every(Boolean)) {
      const values = cells.map(pyInt);
      if (values.some((v) => v < 1 || v > 5)) throw new Error("Wellness items must be 1 to 5");
      score = values.reduce((a, b) => a + b, 0);
    }
    return { athlete_id: text(r, "athlete_id"), day: isoDate(text(r, "date")), score };
  });
}

// ---- crosswalk.py ----
export const POSITIONS = ["SP", "RP", "C", "IF", "OF"];
const key = (text) => text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

export function readCrosswalk({ headers, rows }) {
  // Python raises a bare KeyError here; the JS says which column is missing.
  const missing = missingCols(headers, ["lc_id", "name", "pos", "vald_external_id", "catapult_name"]);
  if (missing.length) throw new Error("Crosswalk is missing columns: " + missing.join(", "));
  const players = new Map();
  const vald = new Map();
  const catapult = new Map();
  for (const r of rows) {
    const id = text(r, "lc_id");
    const pos = text(r, "pos");
    if (!POSITIONS.includes(pos)) throw new Error(`Unknown position '${r.pos}' for ${id}`);
    if (players.has(id)) throw new Error(`duplicate Lineup Card ID ${id}`);
    players.set(id, { lc_id: id, name: text(r, "name"), pos });
    for (const [table, raw] of [[vald, text(r, "vald_external_id")], [catapult, key(text(r, "catapult_name"))]]) {
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
// Python returns the first row for the day, so a repeated date keeps its first row.
export function readSchedule({ rows }) {
  const days = new Map();
  for (const r of rows) {
    if (r.date == null || days.has(r.date)) continue;
    days.set(r.date, { opponent: r.opponent ?? "", home_away: r.home_away ?? "", note: r.note ?? "" });
  }
  return days;
}

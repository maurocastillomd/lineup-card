// Files in, day JSON out: pipeline.py (virtual folders by row date) plus
// build_site.py's date selection. Pure function: no DOM, no storage, no network.

import { CleanLog, cleanCatapult, cleanCmj, cleanWellness } from "./clean.mjs";
import { parseCsv } from "./csv.mjs";
import { cmpTuple } from "./pymath.mjs";
import { buildDay } from "./day.mjs";
import { classify, nameKey, readCatapult, readCrosswalk, readSchedule, readVald, readWellness, valdRowDates } from "./read.mjs";

const SOURCES = [["vald", readVald, cleanCmj], ["catapult", readCatapult, cleanCatapult], ["wellness", readWellness, cleanWellness]];
const NO_GAME = { opponent: "", home_away: "", note: "" };

// Two files hold the same row when the identity and the values match. Display
// fields (VALD Name, Catapult spelling and spacing) are left out on purpose.
const OVERLAP_KEY = {
  vald: (r) => [r.external_id, r.day, r.trial, r.jump_height_cm, r.rsi_mod],
  catapult: (r) => [nameKey(r.player_name), r.day, r.period_number, r.period_name, r.player_load, r.throw_count, r.pitch_count],
  wellness: (r) => [r.athlete_id, r.day, r.score],
};

// Read a file, naming it in any error.
function named(name, fn) {
  try { return fn(); } catch (e) { throw new Error(`${name}: ${e.message}`); }
}

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
  // Read files by name, never by drop order, so later-wins and first-wins rules
  // give the same card however the files were picked. Plain < like Python's sorted().
  for (const list of Object.values(kinds)) list.sort((a, b) => cmpTuple([a.name], [b.name]));
  if (kinds.roster.length !== 1) problems.push(kinds.roster.length ? "Drop only one roster file" : "Add the roster file (roster.csv)");
  if (kinds.schedule.length > 1) problems.push("Drop only one schedule file");
  return { kinds, problems };
}

export function buildDays(files, club, { showDays = 14 } = {}) {
  const { kinds, problems } = sortFiles(files);
  if (problems.length) throw new Error(problems.join("\n"));
  const cw = named(kinds.roster[0].name, () => readCrosswalk(kinds.roster[0].table));
  const schedule = kinds.schedule.length ? named(kinds.schedule[0].name, () => readSchedule(kinds.schedule[0].table)) : new Map();

  // Read every file, dedupe identical rows across files, then group rows by date.
  // date -> { vald: [], catapult: [], wellness: [], dupes: Map(kind -> count), raw: has a data row }
  const byDay = new Map();
  const at = (d) => {
    if (!byDay.has(d)) byDay.set(d, { vald: [], catapult: [], wellness: [], dupes: new Map(), raw: false });
    return byDay.get(d);
  };
  for (const [kind, read] of SOURCES) {
    const earlier = new Set();                 // rows from earlier files of this kind
    for (const { name, table } of kinds[kind]) {
      const rows = named(name, () => read(table));
      // Python counts a day when any export has a data row, before the CMJ filter.
      if (kind === "vald") for (const d of valdRowDates(table)) at(d).raw = true;
      const here = [];
      for (const row of rows) {
        const k = JSON.stringify(OVERLAP_KEY[kind](row));
        const day = at(row.day);
        day.raw = true;
        // Only overlap BETWEEN files is dropped. Repeats inside one file go to the
        // cleaning rules (duplicate_period, duplicate_form), exactly as in Python.
        if (earlier.has(k)) { day.dupes.set(kind, (day.dupes.get(kind) ?? 0) + 1); continue; }
        here.push(k);
        day[kind].push(row);
      }
      for (const k of here) earlier.add(k);
    }
  }
  const all = [...byDay.keys()].sort();
  const withRows = all.filter((d) => byDay.get(d).raw);
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
    for (const [kind, n] of byDay.get(today).dupes) log.add("", today, kind, "duplicate_row", `${n} ${kind} row(s) appeared in two files; counted once`);
    days[today] = buildDay(readings, today, cw, log, schedule.get(today) ?? NO_GAME, club);
  }
  return { index: { dates, latest: dates.at(-1) }, days };
}

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

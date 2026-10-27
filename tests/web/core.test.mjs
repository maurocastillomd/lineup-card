import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../web/js/core/csv.mjs";
import { CleanLog, cleanCatapult, cleanCmj, cleanWellness, makeReading } from "../../web/js/core/clean.mjs";
import { classify, readCatapult, readCrosswalk, readSchedule, readVald, readWellness } from "../../web/js/core/read.mjs";

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

test("parseCsv follows csv.DictReader on odd input", () => {
  // blank lines skipped; short row gives null; extra cells dropped; bare CR; last line without newline
  const out = parseCsv("a,b\n\n1\n3,4,5\r6,7");
  assert.deepEqual(out.rows, [{ a: "1", b: null }, { a: "3", b: "4" }, { a: "6", b: "7" }]);
  // a quote inside an unquoted cell is literal; newline inside quotes stays; a line of "," is a row
  assert.deepEqual(parseCsv('a,b\nx"y,"p\nq"\n,\n').rows, [{ a: 'x"y', b: "p\nq" }, { a: "", b: "" }]);
  assert.deepEqual(parseCsv("").rows, []);
});

test("readers name the column when a short row lacks a value", () => {
  assert.throws(() => readWellness(parseCsv("athlete_id,date,sleep_quality,soreness,fatigue,stress,mood\nLC01,2026-09-20,2\n")), /no value for column 'soreness'/);
});

test("readSchedule keeps the first row for a repeated date", () => {
  const s = readSchedule(parseCsv("date,opponent,home_away,note\n2026-09-20,Cubs,home,a\n2026-09-20,Mets,away,b\n2026-09-21,Reds,away\n"));
  assert.deepEqual(s.get("2026-09-20"), { opponent: "Cubs", home_away: "home", note: "a" });
  assert.equal(s.get("2026-09-21").note, "");
});

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

test("cleanWellness keeps a re-assigned key in its first position; unknown ids held once", () => {
  const cw2 = readCrosswalk(parseCsv("lc_id,name,pos,vald_external_id,catapult_name\nLC01,A,RP,V1,A\nLC02,B,SP,V2,B\n"));
  const log = new CleanLog();
  const w = (id, score) => ({ athlete_id: id, day: "2026-09-20", score });
  const out = cleanWellness([w("LC02", 10), w("LC01", 11), w("LC02", 12), w("ZZ", 9), w("ZZ", 8), w("LC01", null)], cw2, log);
  assert.deepEqual(out.map((r) => [r.athlete_id, r.value]), [["LC02", 12]]);
  assert.deepEqual(log.entries.map((e) => e.rule), ["duplicate_form", "duplicate_form", "incomplete_form"]);
  assert.deepEqual(log.held_out, [{ source: "wellness", raw: "ZZ", reason: "not in crosswalk" }]);
});

test("makeReading enforces the pydantic checks", () => {
  assert.throws(() => makeReading(cw, "LC01", "2026-09-20", "bogus", 1, "x"), /Unknown metric/);
  assert.throws(() => makeReading(cw, "LC01", "2026-09-20", "rsi_mod", NaN, "x"), /finite/);
  assert.throws(() => makeReading(cw, "LC01", "2026-09-20", "rsi_mod", -1, "x"), /negative/);
  assert.equal(makeReading(cw, "LC01", "2026-09-20", " rsi_mod ", 0.4, " vald ").source, "vald");
});

// ---- Task 5: engine and frames ----
import { assessAthlete, assessDomain, assessSquad, loadContext, METRICS, noiseThreshold } from "../../web/js/core/engine.mjs";
import { teamShift, testSensitivity, typicalError } from "../../web/js/core/frames.mjs";
import { addDays } from "../../web/js/core/dates.mjs";

const series = (vals, end = "2026-09-20") => vals.map((v, i) => [addDays(end, i - vals.length + 1), v]);
const steady = [0.45, 0.46, 0.44, 0.45, 0.47, 0.45, 0.44, 0.46, 0.45, 0.46, 0.45, 0.44];

test("assessDomain flags a large drop as review", () => {
  const d = assessDomain(METRICS.neuromuscular, series([...steady, 0.38]), "2026-09-20");
  assert.equal(d.status, "review");
  assert.match(d.reasons[0], /RSI-mod \d\.\d SD below his 28-day normal; test noise not yet estimated/);
  // full object, values from the Python engine on the same input
  assert.deepEqual(d, {
    domain: "neuromuscular", status: "review", fresh: true, observed_on: "2026-09-20", today: 0.38,
    base: { mean: 0.45166666666666666, sd: 0.00937436866561092, n: 12, swc: 0.001874873733122184 },
    pct: -15.9, decline_z: -7.644959273851665, consecutive_declines: 3, te: null, beyond_noise: null,
    reasons: ["RSI-mod 7.6 SD below his 28-day normal; test noise not yet estimated"],
  });
});

test("the 1.5 x TE gate turns a small drop into no change", () => {
  const d = assessDomain(METRICS.neuromuscular, series([...steady, 0.43]), "2026-09-20", 0.05);
  assert.equal(d.status, "cleared");
  assert.equal(d.reasons[0], "RSI-mod drop inside test noise (TE 0.05 m/s)");
  assert.equal(d.decline_z, -2.311266757210969);
  assert.equal(d.pct, -4.8);
  assert.equal(noiseThreshold(0.02), 0.03);
});

test("fewer than 10 readings is baseline-building", () => {
  const d = assessDomain(METRICS.neuromuscular, series(steady.slice(0, 5)), "2026-09-20");
  assert.equal(d.status, "insufficient_data");
  assert.deepEqual(d.reasons, ["baseline-building"]);
  assert.equal(d.today, 0.47);
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
  assert.deepEqual(testSensitivity([0.4, 0.5], 0.01), {
    n: 2, grand_mean: 0.45, between_sd: 0.0707, te: 0.01, cv_pct: 2.2, swc: 0.0141,
    swc_te: 1.41, mdc95: 0.0277, gate: 0.015, rating: "good",
  });
});

// A small squad; expected values from running the Python engine on the same rows.
const D0 = "2026-09-01";
const twoDomains = (athlete_id, name, pos, rsi, well) => rsi.flatMap((r, i) => [
  { athlete_id, name, pos, day: addDays(D0, i), metric: "rsi_mod", value: r, source: "synthetic" },
  { athlete_id, name, pos, day: addDays(D0, i), metric: "wellness_score", value: well[i], source: "synthetic" },
]);
const rep = (pair, n) => Array.from({ length: n }, () => pair).flat();
const SQ_TODAY = addDays(D0, 20);
const squadRows = () => [
  ...twoDomains("LC01", "J. Doe", "RP", [...rep([0.55, 0.57], 10), 0.546], [...rep([20, 22], 10), 19]),
  ...twoDomains("LC02", "A. Ruiz", "C", [...rep([0.55, 0.57], 10), 0.56], [...rep([20, 22], 10), 21]),
  ...twoDomains("LC03", "B. Lee", "SP", [...rep([0.55, 0.57], 10), 0.53], [...rep([20, 22], 10), 21]),
  ...twoDomains("LC04", "C. Kim", "OF", rep([0.55, 0.57], 3), rep([20, 22], 3)),
  { athlete_id: "LC01", name: "J. Doe", pos: "RP", day: SQ_TODAY, metric: "throw_count", value: 12.5, source: "synthetic" },
  { athlete_id: "LC01", name: "J. Doe", pos: "RP", day: SQ_TODAY, metric: "player_load", value: 301.7, source: "synthetic" },
];
const SQ_TE = { rsi_mod: 0.005, wellness_score: 0.5 };

test("assessAthlete: two Watch domains beyond noise converge to Check in", () => {
  const a = assessAthlete(squadRows().filter((r) => r.athlete_id === "LC01"), SQ_TODAY, SQ_TE);
  assert.equal(a.status, "review");
  assert.deepEqual(a.domains.map((d) => [d.status, d.decline_z]), [["monitor", -1.9493588689617927], ["monitor", -1.3645512082732516]]);
  assert.deepEqual(a.drivers, ["perceptual", "neuromuscular"]);
  assert.deepEqual(a.reasons, [
    "2 response domains at or below z -1.2; convergence review rule",
    "Wellness 1.9 SD below his 28-day normal and beyond test noise",
    "RSI-mod 1.4 SD below his 28-day normal and beyond test noise",
  ]);
  // 12.5 throws rounds half to even, like Python's int(round())
  assert.deepEqual(a.load, { player_load_today: 301.7, throws_today: 12, pitches_today: null, throws_7d: 12 });
  assert.deepEqual(Object.keys(a), ["athlete_id", "name", "pos", "status", "domains", "drivers", "load", "reasons"]);
});

test("assessSquad sorts worst first, as Python does", () => {
  const out = assessSquad(squadRows(), SQ_TODAY, SQ_TE);
  assert.deepEqual(out.map((a) => [a.athlete_id, a.status]),
    [["LC03", "review"], ["LC01", "review"], ["LC04", "insufficient_data"], ["LC02", "cleared"]]);
  assert.deepEqual(out[3].domains.map((d) => d.decline_z), [0.0, 1.0821115497893228e-14]);
  assert.deepEqual(out[2].reasons, ["Incomplete response-domain coverage; check missing or stale data"]);
  assert.equal(typicalError(squadRows(), "rsi_mod", SQ_TODAY), 0.0142);
  assert.deepEqual(loadContext([], D0), { player_load_today: null, throws_today: null, pitches_today: null, throws_7d: null });
});

test("assessAthlete refuses two identities for one athlete", () => {
  const rows = squadRows().filter((r) => r.athlete_id === "LC02");
  rows[0] = { ...rows[0], name: "Someone Else" };
  assert.throws(() => assessAthlete(rows, SQ_TODAY), /Conflicting athlete identities/);
});

// ---- Review fixes: run.mjs (files in, days out) ----
import { buildDays, sortFiles } from "../../web/js/core/run.mjs";

const ROSTER = { name: "roster.csv", text: "lc_id,name,pos,vald_external_id,catapult_name\nLC01,J. Ortega,RP,V010,Jorge Ortega\n" };
const WELL_HEAD = "athlete_id,date,sleep_quality,soreness,fatigue,stress,mood\n";
const VALD_HEAD = "Name,ExternalId,Date,Time,Test Type,Trial,Jump Height (Imp-Mom) [cm],RSI-modified [m/s]\n";
const CAT_HEAD = "player_name,period_name,period_number,start_time,end_time,duration,player_load,throw_count,pitch_count\n";
const logOf = (out, day) => out.days[day].cleaning_log;

test("buildDays gives the same result whatever order the files are dropped in", () => {
  const a = { name: "a-wellness.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\n" };
  const b = { name: "b-wellness.csv", text: WELL_HEAD + "LC01,2026-09-20,4,4,4,4,4\n" };
  const one = buildDays([ROSTER, a, b], null);
  const two = buildDays([b, ROSTER, a], null);
  assert.deepEqual(two, one);
  // files are read by name, so b's form is the later one and wins
  assert.equal(one.days["2026-09-20"].players[0].wellness.today, 20);
});

test("Catapult duplicate periods across files do not depend on drop order", () => {
  const a = { name: "a-cat.csv", text: CAT_HEAD + "Jorge Ortega,Game,1,2026-09-19T18:00:00Z,,,100,,\n" };
  const b = { name: "b-cat.csv", text: CAT_HEAD + "Jorge Ortega,Game,1,2026-09-19T18:00:00Z,,,200,,\n" };
  const w = { name: "w.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\n" };
  const one = buildDays([ROSTER, a, b, w], null);
  assert.deepEqual(buildDays([ROSTER, w, b, a], null), one);
  // first period wins (duplicate_period), and a-cat.csv is read first
  assert.equal(one.days["2026-09-20"].players[0].load.player_load_today, 100);
});

test("the same VALD trial with a differently spelled Name counts once", () => {
  const a = { name: "a-vald.csv", text: VALD_HEAD + "J. Ortega,V010,2026-09-20,07:41,CMJ,1,33.9,0.448\nJ. Ortega,V010,2026-09-20,07:42,CMJ,2,34.1,0.452\n" };
  const b = { name: "b-vald.csv", text: VALD_HEAD + "Jorge Ortega,V010,2026-09-20,07:41,CMJ,1,33.9,0.448\nJorge Ortega,V010,2026-09-20,07:42,CMJ,2,34.1,0.452\n" };
  const out = buildDays([ROSTER, a, b], null);
  assert.deepEqual(logOf(out, "2026-09-20").filter((e) => e.rule === "duplicate_row"),
    [{ lc_id: "", day: "2026-09-20", source: "vald", rule: "duplicate_row", detail: "2 vald row(s) appeared in two files; counted once" }]);
});

test("Catapult overlap keys on the normalised player name; wellness on id, day and score", () => {
  const a = { name: "a-cat.csv", text: CAT_HEAD + "Jorge Ortega,Game,1,2026-09-20T18:00:00Z,x,y,100,,\n" };
  const b = { name: "b-cat.csv", text: CAT_HEAD + "jorge  ortega,Game,1,2026-09-20T18:00:00Z,,,100,,\n" };
  const w1 = { name: "w1.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\n" };
  const w2 = { name: "w2.csv", text: WELL_HEAD + "LC01,2026-09-20,4,2,3,3,3\n" };   // same total, other items
  const rules = logOf(buildDays([ROSTER, a, b, w1, w2], null), "2026-09-20").filter((e) => e.rule === "duplicate_row");
  assert.deepEqual(rules.map((e) => [e.source, e.detail]), [
    ["catapult", "1 catapult row(s) appeared in two files; counted once"],
    ["wellness", "1 wellness row(s) appeared in two files; counted once"],
  ]);
});

test("a day whose only VALD rows are not CMJ still gets a card, as in Python", () => {
  const v = { name: "vald.csv", text: VALD_HEAD + "J. Ortega,V010,2026-09-21,07:41,SJ,1,30.0,0.400\n" };
  const w = { name: "w.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\n" };
  assert.deepEqual(buildDays([ROSTER, v, w], null).index.dates, ["2026-09-20", "2026-09-21"]);
});

test("errors name the file and the row", () => {
  const badRoster = { name: "roster.csv", text: ROSTER.text + "LC02,K. Ruiz,P,V020,Kevin Ruiz\n" };
  assert.throws(() => buildDays([badRoster], null), /^Error: roster\.csv: row 3: Unknown position 'P' for LC02$/);
  const w = { name: "w.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\nLC01,2026-09-21,9,3,3,3,3\n" };
  assert.throws(() => buildDays([ROSTER, w], null), /^Error: w\.csv: row 3: Wellness items must be 1 to 5$/);
  const v = { name: "v.csv", text: VALD_HEAD + "J. Ortega,V010,20-09-2026,07:41,CMJ,1,33.9,0.448\n" };
  assert.throws(() => buildDays([ROSTER, v], null), /^Error: v\.csv: row 2: invalid date/);
  const c = { name: "c.csv", text: CAT_HEAD + "Jorge Ortega,Game,1,2026-09-20T18:00:00,,,100,,\n" };
  assert.throws(() => buildDays([ROSTER, c], null), /^Error: c\.csv: row 2: start_time/);
});

test("rows where every cell is blank are skipped (Excel leftovers)", () => {
  const w = { name: "w.csv", text: WELL_HEAD + "LC01,2026-09-20,3,3,3,3,3\n,,,,,,\n , ,,,,,\n" };
  const v = { name: "v.csv", text: VALD_HEAD + ",,,,,,,\n" };
  const c = { name: "c.csv", text: CAT_HEAD + ",,,,,,,,\n" };
  const r = { name: "roster.csv", text: ROSTER.text + ",,,,\n" };
  assert.deepEqual(buildDays([r, w, v, c], null).index.dates, ["2026-09-20"]);
});

test("more than one schedule file is a problem, like the roster", () => {
  const s1 = { name: "s1.csv", text: "date,opponent,home_away\n" };
  const s2 = { name: "s2.csv", text: "date,opponent,home_away\n" };
  assert.deepEqual(sortFiles([ROSTER, s1, s2]).problems, ["Drop only one schedule file"]);
});

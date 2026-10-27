import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../web/js/core/csv.mjs";
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

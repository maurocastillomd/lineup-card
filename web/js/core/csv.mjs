// CSV text -> { headers, rows } with rows as objects keyed by header, like
// Python's csv.DictReader with encoding="utf-8-sig". Handles quotes, "" escapes,
// commas and newlines inside quotes, CRLF or bare CR, and a leading BOM.
// Differences from DictReader, on purpose: extra cells are dropped (Python keeps
// them under the key None). Like Python: a line with no characters is skipped,
// a short row gives null for the missing cells, a quote only opens at the start
// of a cell, and a duplicate header keeps the last column.

export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let atStart = true;   // at the first character of a cell
  let touched = false;  // the current line has at least one character
  const endCell = () => { row.push(cell); cell = ""; atStart = true; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      if (touched) { endCell(); records.push(row); }
      row = []; cell = ""; atStart = true; touched = false;
      continue;
    }
    touched = true;
    if (c === ",") endCell();
    else if (c === '"' && atStart) { quoted = true; atStart = false; }
    else { cell += c; atStart = false; }
  }
  if (touched) { endCell(); records.push(row); }
  const headers = records.shift() ?? [];
  const rows = records.map((r) => Object.fromEntries(headers.map((h, i) => [h, i < r.length ? r[i] : null])));
  return { headers, rows };
}

// Dates are ISO "YYYY-MM-DD" strings everywhere. Day arithmetic goes through
// UTC midnights so daylight-saving changes never shift a day.

const DAY_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(cell) {
  const s = String(cell).trim();
  if (!ISO.test(s)) throw new Error(`invalid date '${cell}' (use YYYY-MM-DD)`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new Error(`invalid date '${cell}'`);
  return s;
}

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY_MS);

const CHICAGO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

// The club's local date for a UTC timestamp, so a 7 p.m. game is not tomorrow.
export function localDayChicago(stamp) {
  const s = String(stamp).trim();
  // Python (fromisoformat after Z -> +00:00) takes Z, +HH, +HHMM and +HH:MM.
  const m = /(Z|([+-]\d{2}):?(\d{2})?)$/.exec(s);
  if (!m) throw new Error(`start_time '${stamp}' needs a time zone (Z or +00:00)`);
  const t = Date.parse(m[1] === "Z" ? s : `${s.slice(0, m.index)}${m[2]}:${m[3] ?? "00"}`);   // Date.parse wants +HH:MM
  if (Number.isNaN(t)) throw new Error(`invalid start_time '${stamp}'`);
  return CHICAGO.format(new Date(t));
}

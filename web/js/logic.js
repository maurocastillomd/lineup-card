// Pure functions. No DOM, no storage. Tested with node --test.

export const WORDS = {
  check_in: "Check in",
  watch: "Watch",
  no_change: "No change",
  not_enough_data: "Not enough data",
};
export const FLAGGED = new Set(["check_in", "watch"]);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const lastName = (name) => norm(name).split(" ").pop();

export function parseLineup(text, players) {
  const ids = [];
  const unmatched = [];
  for (const raw of text.split(/\n|,/).map((l) => l.trim()).filter(Boolean)) {
    const key = norm(raw);
    const exact = players.find((p) => p.id.toLowerCase() === key || norm(p.name) === key);
    // A last name shared by two players is not a match: never guess which one.
    const byLast = players.filter((p) => lastName(p.name) === key);
    const hit = exact ?? (byLast.length === 1 ? byLast[0] : undefined);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    else if (!hit) unmatched.push(raw);
  }
  return { ids, unmatched };
}

export function applyDecisions(players, decisions) {
  return players.map((p) => {
    const d = decisions[p.id];
    if (!d || d.action === "confirm") return { ...p };
    if (d.action === "remove") {
      return { ...p, status: "no_change", word: WORDS.no_change, reviewNote: `Flag removed: ${d.note}` };
    }
    return { ...p, status: d.status, word: WORDS[d.status], reviewNote: `Changed to ${WORDS[d.status]}: ${d.note}` };
  });
}

// Check-in list order: Check in before Watch, then lowest RSI-mod z first; no z goes last.
const zKey = (p) => p.rsi?.z ?? Number.MAX_VALUE;
const byConcern = (a, b) =>
  (a.status === "check_in" ? 0 : 1) - (b.status === "check_in" ? 0 : 1) || zKey(a) - zKey(b);

// On a team-shift day (whole roster down beyond test noise), split flagged players into
// those down more than the team (or with no RSI reading today) and those down with it.
export function groupCheckins(players, teamShift) {
  const flagged = players.filter((p) => FLAGGED.has(p.status)).sort(byConcern);
  if (!teamShift?.beyond_noise) return { lead: false, more: flagged, withTeam: [] };
  return {
    lead: true,
    more: flagged.filter((p) => p.beyond_team !== false),
    withTeam: flagged.filter((p) => p.beyond_team === false),
  };
}

// How the printed page makes room for the boxes, so the card stays one Letter page with a
// roster of at least 9pt. Up to 4 boxes: two across, with pictures and every reason. 5 or 6:
// three across, no pictures, the first two reasons. 7 or more: a list, one line each, with only
// the reason that drove the flag. The roster table shows every player's jump and morning form,
// and a reviewer's note always prints. roster = the roster table's type size in pt (9 to 10),
// rowGap = the space above and below each roster row in pt, larger when there is room to fill.
export function printLayout(boxes) {
  if (boxes <= 4) {
    return { density: "roomy", pictures: true, reasons: "all", roster: 10, rowGap: [9, 6, 3.5][boxes] ?? 2.5 };
  }
  if (boxes <= 6) return { density: "normal", pictures: false, reasons: 2, roster: 10, rowGap: 1.5 };
  if (boxes >= 12) return { density: "tight", pictures: false, reasons: 1, roster: 9, rowGap: 0.5 };
  return { density: "tight", pictures: false, reasons: 1, roster: 10, rowGap: { 7: 4, 8: 3 }[boxes] ?? 1.5 };
}

// The label in the full roster list. On a team-drop day a flagged player whose drop the team
// drop explains (beyond_team === false) reads "Down with team" with a neutral mark, so the
// list agrees with the headline. His status, the export and the review are not changed.
export function rosterLabel(p, teamShift) {
  if (teamShift?.beyond_noise && FLAGGED.has(p.status) && p.beyond_team === false) {
    return { kind: "with_team", word: "Down with team" };
  }
  return { kind: p.status, word: p.word };
}

// The printed roster's short columns: jump against his usual, and a low morning form.
export function rosterJump(p) {
  const pct = p.rsi?.pct;
  if (pct == null) return p.rsi?.today == null ? "no jump today" : "no history yet";
  const size = Math.abs(pct) < 1 ? "at his usual" : `${Math.round(Math.abs(pct))}% ${pct < 0 ? "below" : "above"}`;
  return isStale(p) ? `${size}, ${daysAgo(p.rsi.days_old)}` : size;
}

export const rosterForm = (p) => (p.wellness?.z != null && p.wellness.z <= -1.2 ? "low" : "");

// Jump today in plain words: percent of his own usual.
export const isStale = (p) => p.rsi?.pct != null && p.rsi.days_old > 0;

const pctWords = (pct) => (Math.abs(pct) < 1 ? "right at his usual"
  : `${Math.round(Math.abs(pct))}% ${pct < 0 ? "below" : "above"} his usual`);
const daysAgo = (n) => `${n} day${n === 1 ? "" : "s"} ago`;
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function plainChange(p) {
  const pct = p.rsi.pct;
  let text;
  if (pct == null) text = p.rsi.today == null ? "No jump today" : "Still learning his usual";
  else text = upperFirst(pctWords(pct));
  // The reading is not from today: say how old it is, in the same sentence.
  if (isStale(p)) text = `Jump ${daysAgo(p.rsi.days_old)}: ${pctWords(pct)}`;
  return p.magnitude?.includes("(wellness)") ? `${text} · wellness low` : text;
}

const PITCHERS = new Set(["SP", "RP"]);

// The reasons in a flagged player's box, one short sentence each. What drove the flag comes
// first: a wellness-driven flag (magnitude "... (wellness)") leads with the morning form.
export function reasonLines(p) {
  const fromWellness = Boolean(p.magnitude?.includes("(wellness)"));
  const pct = p.rsi?.pct;
  let jump;
  if (pct == null) jump = p.rsi?.today == null ? "No jump today" : "Not enough jump history yet";
  else if (isStale(p)) jump = `Last jump ${daysAgo(p.rsi.days_old)}: ${pctWords(pct)}`;
  else if (fromWellness && Math.abs(pct) < 1) jump = "Jump looks normal";
  else jump = `Jumping ${pctWords(pct)}`;
  const z = p.wellness?.z;
  const form = z == null || z > -1.2 ? null
    : `Felt ${z <= -2.0 ? "much " : ""}worse than usual on this morning's form`;
  const lines = fromWellness ? [form, jump] : [jump, form];
  if (PITCHERS.has(p.pos) && p.load?.throws_7d != null) lines.push(`${p.load.throws_7d} throws and pitches in the last 7 days`);
  if (p.reviewNote) lines.push(p.reviewNote);
  return lines.filter(Boolean);
}

const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Two-week jump picture for a flagged player's box. Each point is that day's jump as z
// against his own baseline; the band is z -1..+1, "his usual range". Colours come from CSS classes.
export function trendSvg(p) {
  const W = 336, H = 84, X0 = 4, X1 = 232, Y0 = 6, Y1 = 62, ZMAX = 4;
  const trend = p.trend ?? [];
  const n = Math.max(trend.length, 2);
  const xOf = (i) => X0 + i * (X1 - X0) / (n - 1);
  const yOf = (z) => Y0 + (ZMAX - Math.max(-ZMAX, Math.min(ZMAX, z))) / (2 * ZMAX) * (Y1 - Y0);
  const f = (v) => v.toFixed(1);
  const pts = trend.map((t, i) => (t.z == null ? null : { x: xOf(i), y: yOf(t.z), z: t.z, i })).filter(Boolean);
  const last = pts.at(-1);
  const bandTop = yOf(1), bandBot = yOf(-1), mid = (bandTop + bandBot) / 2;

  let words;
  if (!last) words = "no jumps yet";
  else {
    const where = last.z < -1 ? "below his usual range" : last.z > 1 ? "above his usual range" : "inside his usual range";
    const when = isStale(p) ? `last jump ${daysAgo(p.rsi.days_old)}` : last.i === trend.length - 1 ? "today" : "last jump";
    const change = p.rsi?.pct != null ? `${isStale(p) ? ":" : ""} ${pctWords(p.rsi.pct)}` : "";
    words = `${when}${change}, ${where}`;
  }
  const label = `${p.name}, jump over the last two weeks: ${words}.`;

  const parts = [
    `<rect class="tr-band" x="${X0}" y="${f(bandTop)}" width="${X1 - X0}" height="${f(bandBot - bandTop)}" rx="2"/>`,
    `<text class="tr-label" x="${X1 + 12}" y="${f(mid + 3)}">his usual range</text>`,
  ];
  if (pts.length > 1) {
    parts.push(`<path class="tr-line" d="${pts.map((q, i) => `${i ? "L" : "M"}${f(q.x)},${f(q.y)}`).join(" ")}"/>`);
  }
  for (const q of pts.slice(0, -1)) parts.push(`<circle class="tr-pt" cx="${f(q.x)}" cy="${f(q.y)}" r="1.8"/>`);
  if (last) {
    const hollow = isStale(p) || last.i !== trend.length - 1;
    parts.push(`<circle class="tr-dot tr-${escXml(p.status)}${hollow ? " tr-hollow" : ""}" cx="${f(last.x)}" cy="${f(last.y)}" r="4.5"/>`);
  }
  parts.push(`<text class="tr-axis" x="${X0}" y="${H - 4}">2 weeks ago</text>`);
  parts.push(`<text class="tr-axis" x="${X1}" y="${H - 4}" text-anchor="end">today</text>`);
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escXml(label)}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

// Analyst line for the review screen: the size of the change in every unit that matters.
export function signalLine(label, unit, d, dp = 3) {
  if (d.change == null) return `${label}: no baseline yet`;
  const parts = [`${label}: ${d.change.toFixed(dp)} ${unit} (${d.pct.toFixed(1)}%)`];
  if (d.change_te != null) parts.push(`${d.change_te.toFixed(1)} TE`);
  parts.push(`z ${d.z.toFixed(2)}`);
  if (d.beyond_noise != null) parts.push(d.beyond_noise ? "past your gate" : "inside your gate");
  if (d.beyond_mdc != null) parts.push(d.beyond_mdc ? "past MDC95" : "inside MDC95");
  return parts.join(" · ");
}

// Plain-text summary for a group text. Whole roster, after review decisions.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-09-20" -> "Sun Sep 20", read in UTC so the day never shifts with the viewer's time zone.
export function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// The card's top line: date and, when the schedule names one, the opponent.
export function topLine(day, date) {
  const s = day?.schedule ?? {};
  const game = s.opponent ? ` · ${s.home_away === "away" ? "Away at" : "Home vs"} ${s.opponent}` : "";
  return `Lineup Card · ${shortDate(date)}${game}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The card's headline and the line under it. Counts are roster-wide, after review decisions.
export function headline(day, players) {
  const shift = day?.team_shift;
  const flagged = players.filter((p) => FLAGGED.has(p.status));
  const usual = players.filter((p) => p.status === "no_change").length;
  const missing = players.filter((p) => p.status === "not_enough_data").map((p) => p.name);
  const history = missing.length ? ` No history yet: ${missing.join(", ")}.` : "";
  if (shift?.beyond_noise) {
    // n = the boxes shown (not explained by the drop), m = the flagged players down with the team.
    const { more, withTeam } = groupCheckins(players, shift);
    const n = more.length, m = withTeam.length;
    const talk = n === 0 ? "Nobody stands out beyond the team drop."
      : `${plural(n, "player", "players")} to talk to anyway.${m ? ` ${m} more ${m === 1 ? "is" : "are"} down with the team.` : ""}`;
    return {
      title: `The whole team is jumping ${Math.abs(Math.round(shift.median_pct))}% ${shift.median_pct < 0 ? "below" : "above"} its usual today`,
      sub: `${talk}${history}`,
    };
  }
  const title = flagged.length === 0 ? "No one stands out today"
    : flagged.length === 1 ? "1 player to talk to before he trains"
      : `${flagged.length} players to talk to before they train`;
  const looks = usual === 0 ? "" : usual === 1 ? "1 looks like his usual self." : `${usual} look like their usual selves.`;
  return { title, sub: `${looks}${history}`.trim() };
}

export function countByStatus(players) {
  const out = { check_in: 0, watch: 0, no_change: 0, not_enough_data: 0 };
  for (const p of players) if (p.status in out) out[p.status]++;
  return out;
}

// "Fictional roster." only on the fictional demo (day.synthetic === true).
export const disclaimer = (day) =>
  `${day?.synthetic === true ? "Fictional roster. " : ""}Not a fitness-to-play decision.`;

// From the pull's _status.json: names a source that failed this morning, or "".
const SOURCE_NAMES = [["vald", "VALD"], ["catapult", "Catapult"]];
export function sourcesNote(day) {
  const failed = SOURCE_NAMES.filter(([key]) => day?.sources?.[key] === "failed").map(([, name]) => name);
  return failed.length ? `${failed.join(" and ")} data not updated this morning.` : "";
}

// The action line in a flagged player's box.
export const ACTION = { check_in: "Talk with him before he trains.", watch: "Keep an eye on him today." };
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// Group text: date line, headline and sub line, each flagged player with his reasons, then the disclaimer.
// reviewed: false puts "NOT REVIEWED YET." first, so an unapproved card is never pasted as approved.
export function plainSummary(day, players, todayIds = [], { reviewed = true } = {}) {
  const lineup = new Set(todayIds);
  const who = (p) => {
    const reasons = reasonLines(p);
    if (lineup.size && !lineup.has(p.id)) reasons.push("Not in today's lineup");
    return `${WORDS[p.status]}: ${p.name} (${p.pos}). ${reasons.map(sentence).join(" ")}`;
  };
  const lines = reviewed ? [] : ["NOT REVIEWED YET."];
  lines.push(topLine(day, day.date));
  const h = headline(day, players);
  lines.push(h.title);
  if (h.sub) lines.push(h.sub);
  const stale = sourcesNote(day);
  if (stale) lines.push(stale);
  const groups = groupCheckins(players, day.team_shift);
  if (groups.lead && groups.more.length) lines.push("Not explained by the team drop:");
  lines.push(...groups.more.map(who));
  if (groups.withTeam.length) lines.push(`Down with the team: ${groups.withTeam.map((p) => p.name).join(", ")}.`);
  lines.push(disclaimer(day));
  return lines.join("\n");
}

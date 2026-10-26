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

export function hiddenSummary(players, todayIds) {
  const hidden = players.filter((p) => !todayIds.includes(p.id));
  const flagged = hidden.filter((p) => FLAGGED.has(p.status));
  const names = flagged.map((p) => `${p.name} (${p.pos})`).join(", ");
  const text = `${hidden.length} others not listed today. ` +
    (flagged.length ? `${flagged.length} flagged: ${names}.` : "None flagged.");
  return { hiddenCount: hidden.length, flagged, text };
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

// z of 0 sits at 50%; each SD moves 15%; clamp to 2..98
export const bandPosition = (z) => Math.max(2, Math.min(98, 50 + z * 15));

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

// Jump today in plain words: percent of his own normal.
export const isStale = (p) => p.rsi?.pct != null && p.rsi.days_old > 0;

export function plainChange(p) {
  const pct = p.rsi.pct;
  let text;
  if (pct == null) text = p.rsi.today == null ? "No jump today" : "Still learning his normal";
  else if (Math.abs(pct) < 1) text = "Right at his normal";
  else text = `${Math.round(Math.abs(pct))}% ${pct < 0 ? "below" : "above"} his normal`;
  if (isStale(p)) {
    // The reading is not from today: say how old it is, in the same sentence.
    const n = p.rsi.days_old;
    text = `Jump ${n} day${n === 1 ? "" : "s"} ago: ${text.replace(/^Right at/, "right at")}`;
  }
  return p.magnitude?.includes("(wellness)") ? `${text} · wellness low` : text;
}

// -20% sits at the left edge, his normal in the middle, +20% at the right edge.
export const jumpPosition = (pct) => Math.max(2, Math.min(98, 50 + pct * 2.4));

// One line for the coach: jump, wellness, and arm workload for pitchers.
export function plainReason(p) {
  const parts = [];
  if (p.rsi.pct != null) {
    const text = plainChange({ ...p, magnitude: "" });
    parts.push(isStale(p) ? text : `Jump ${text.replace(/^Right at/, "right at")}`);
  }
  if (p.wellness?.z != null && p.wellness.z <= -1.2) parts.push("wellness low");
  if (["SP", "RP"].includes(p.pos) && p.load?.throws_7d != null) parts.push(`${p.load.throws_7d} throws + pitches in 7 days`);
  return parts.join(" · ");
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

// "Whole team jumping 10% below normal." plus the schedule note, if any.
export function teamLine(day) {
  const s = day.team_shift;
  if (!s?.beyond_noise) return "";
  const note = day.schedule?.note ? ` ${day.schedule.note.replace(/\.$/, "")}.` : "";
  return `Whole team jumping ${Math.abs(Math.round(s.median_pct))}% ${s.median_pct < 0 ? "below" : "above"} normal.${note}`;
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

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function plainSummary(day, players, todayIds = []) {
  // todayIds is accepted so callers can pass the lineup; the summary always covers the whole roster,
  // so a flagged player who is not in today's lineup is still named.
  void todayIds;
  const who = (p) => {
    const reason = plainReason(p).split(" · ").filter(Boolean).map(lowerFirst).join(", ");
    return `${p.name} ${p.pos}${reason ? `, ${reason}` : ""}${p.reviewNote ? ` (${p.reviewNote})` : ""}`;
  };
  const statusLines = (list) => ["check_in", "watch"].flatMap((s) => {
    const xs = list.filter((p) => p.status === s);
    return xs.length ? [`${WORDS[s]} (${xs.length}): ${xs.map(who).join("; ")}`] : [];
  });

  const lines = [`Lineup Card, ${shortDate(day.date)}, vs ${day.schedule.opponent} (${day.schedule.home_away})`];
  const stale = sourcesNote(day);
  if (stale) lines.push(stale);
  const groups = groupCheckins(players, day.team_shift);
  if (groups.lead) {
    lines.push(teamLine(day));
    if (groups.more.length) lines.push("Not explained by the team drop:", ...statusLines(groups.more));
    else lines.push("Nobody is down more than the team.");
    if (groups.withTeam.length) {
      lines.push(`Down with the team (${groups.withTeam.length}): ${groups.withTeam.map((p) => p.name).join(", ")}.`);
    }
  } else if (groups.more.length) {
    lines.push(...statusLines(groups.more));
  } else {
    lines.push("Nobody to check in on today.");
  }
  const n = countByStatus(players);
  const missing = players.filter((p) => p.status === "not_enough_data").map((p) => p.name);
  lines.push(`No change: ${n.no_change}. Not enough data: ${n.not_enough_data}${missing.length ? ` (${missing.join(", ")})` : ""}.`);
  lines.push(disclaimer(day));
  return lines.join("\n");
}

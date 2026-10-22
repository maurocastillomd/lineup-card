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

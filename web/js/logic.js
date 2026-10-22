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
    const hit = players.find((p) => p.id.toLowerCase() === key || norm(p.name) === key)
      ?? players.filter((p) => lastName(p.name) === key).at(0);
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

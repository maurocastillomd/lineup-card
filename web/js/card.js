import { applyDecisions, bandPosition, groupCheckins, hiddenSummary } from "./logic.js";
import { loadReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GROUPS = [["SP", "Starters"], ["RP", "Relievers"], ["C", "Catchers"], ["IF", "Infield"], ["OF", "Outfield"]];

const index = await (await fetch("data/index.json")).json();
const date = new URLSearchParams(location.search).get("date") ?? index.latest;
const day = await (await fetch(`data/days/${date}.json`)).json();
let review = loadReview(date);
let example = false;
if (!review.approvedAt) {
  // A visitor with no saved review sees a bundled example review, labeled as such.
  const res = await fetch(`examples/review-${date}.json`);
  if (res.ok) { review = await res.json(); example = true; }
}
const players = applyDecisions(day.players, review.decisions);
const todayIds = review.todayIds.length ? review.todayIds : players.map((p) => p.id);

$("meta").textContent = `${day.club} · ${date} · vs ${day.schedule.opponent} (${day.schedule.home_away})` +
  (review.approvedAt ? ` · reviewed by ${review.reviewer}${example ? " (example review)" : ""}` : "");
$("unreviewed").hidden = Boolean(review.approvedAt);
$("print").addEventListener("click", () => print());

const shift = day.team_shift;
const groups = groupCheckins(players, shift);
const flagged = [...groups.more, ...groups.withTeam];
const shiftText = shift
  ? `Whole roster RSI-mod ${shift.median_pct}% vs normal (n ${shift.n}).${day.schedule.note ? ` ${day.schedule.note}.` : ""}`
  : "";
const checkinItem = (p) => `<li><strong>${esc(p.name)}</strong> ${esc(p.pos)} ·
  <span class="word-${p.status}">${esc(p.word)}</span> ${esc(p.magnitude)}
  <small>${p.reasons.map(esc).join("; ")}${p.reviewNote ? ` · ${esc(p.reviewNote)}` : ""}${pitchLine(p)}</small></li>`;

if (groups.lead) {
  // Team-shift day: the team line leads, then who dropped more than the team, then a names-only line.
  $("shift-lead").textContent = shiftText;
  $("shift-lead").hidden = false;
  $("more-label").hidden = false;
  $("checkin").innerHTML = groups.more.length ? groups.more.map(checkinItem).join("")
    : "<li>Nobody is down more than the team.</li>";
  $("with-team").textContent = groups.withTeam.length
    ? `Down with the team (${groups.withTeam.length}): ${groups.withTeam.map((p) => p.name).join(", ")}.`
    : "";
  $("shift").textContent = "";
} else {
  $("checkin").innerHTML = flagged.length ? flagged.map(checkinItem).join("")
    : "<li>Nobody needs a check-in today.</li>";
  $("shift").textContent = shift && shift.beyond_noise ? shiftText : "";
}

const league = day.league_reference.rsi_mod;
$("league").textContent = `League context: RSI-mod ${league.value} ${league.unit} (${league.label}).`;

function pitchLine(p) {
  if (!["SP", "RP"].includes(p.pos) || p.load.throws_7d == null) return "";
  return ` · throws + pitches, last 7 days: ${p.load.throws_7d}`;
}

function row(p) {
  const z = p.rsi.z;
  const te = day.te.rsi_mod && p.rsi.sd ? day.te.rsi_mod / p.rsi.sd : null;
  const track = z == null ? `<span class="none">baseline building</span>` : `
    ${p.position_median_z == null ? "" : `<span class="tick" style="left:${bandPosition(p.position_median_z)}%" title="${p.pos} median, n ${p.position_n}"></span>`}
    ${te == null ? "" : `<span class="noise" style="left:${bandPosition(z - te)}%;width:${bandPosition(z + te) - bandPosition(z - te)}%"></span>`}
    <span class="dot" style="left:${bandPosition(z)}%"></span>`;
  return `<div class="band-row"><div>${esc(p.name)}<small>${esc(p.pos)} · RSI-mod ${p.rsi.today ?? "n/a"}</small></div>
    <div class="track"><span class="band"></span>${track}</div>
    <div><span class="word-${p.status}">${esc(p.word)}</span><small>${esc(p.magnitude)}</small></div></div>`;
}

function grouped(list) {
  return GROUPS.map(([pos, label]) => {
    const rows = list.filter((p) => p.pos === pos);
    return rows.length ? `<p class="group-label">${label}</p>${rows.map(row).join("")}` : "";
  }).join("");
}

$("today").innerHTML = grouped(players.filter((p) => todayIds.includes(p.id)));
$("rest").innerHTML = grouped(players.filter((p) => !todayIds.includes(p.id)));
const summary = hiddenSummary(players, todayIds);
$("hidden-summary").textContent = summary.hiddenCount ? summary.text : "";
$("toggle").hidden = !summary.hiddenCount;
$("toggle").addEventListener("click", () => {
  const open = $("rest").hidden;
  $("rest").hidden = !open;
  $("toggle").textContent = open ? "Hide full roster" : "Show full roster";
  $("toggle").setAttribute("aria-expanded", String(open));
});

$("trends").innerHTML = flagged.slice(0, 5).map((p) => {
  const pts = p.trend.map((t, i) => t.z == null ? null : [i * 10 + 2, 17 - Math.max(-3, Math.min(3, t.z)) * 5]);
  const path = pts.filter(Boolean).map((xy, i) => `${i ? "L" : "M"}${xy[0]},${xy[1]}`).join(" ");
  return `<div class="spark"><span>${esc(p.name)}</span><svg viewBox="0 0 134 34" role="img" aria-label="${esc(p.name)} RSI-mod z, last 14 days">
    <rect x="0" y="12" width="134" height="10" fill="var(--surface)"/><path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5"/></svg></div>`;
}).join("") || "<p>No flagged players.</p>";

try {
  const res = await fetch("figures/board/board.svg");
  if (!res.ok) throw new Error("no board");
  $("board").innerHTML = await res.text();
  for (const p of players) $("board").querySelector(`.peg[data-id="${p.id}"]`)?.setAttribute("data-status", p.status);
} catch {
  $("board").textContent = "Board figure not built yet.";
}

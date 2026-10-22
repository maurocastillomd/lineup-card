import { applyDecisions, groupCheckins, hiddenSummary, isStale, jumpPosition, plainChange, plainReason } from "./logic.js";
import { hasSavedReview, loadReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GROUPS = [["SP", "Starters"], ["RP", "Relievers"], ["C", "Catchers"], ["IF", "Infield"], ["OF", "Outfield"]];

const index = await (await fetch("data/index.json")).json();
const date = new URLSearchParams(location.search).get("date") ?? index.latest;
const day = await (await fetch(`data/days/${date}.json`)).json();
let review = loadReview(date);
let example = false;
if (!hasSavedReview(date)) {
  // Only a visitor with nothing saved for this date sees the bundled example, labeled as such.
  // A partial or unapproved review of their own is shown as theirs, under the "Not reviewed yet" banner.
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
  ? `Whole team jumping ${Math.abs(Math.round(shift.median_pct))}% ${shift.median_pct < 0 ? "below" : "above"} normal (${shift.n} players tested).${day.schedule.note ? ` ${day.schedule.note}.` : ""}`
  : "";
const checkinItem = (p) => `<li><strong>${esc(p.name)}</strong> ${esc(p.pos)} ·
  <span class="word-${esc(p.status)}">${esc(p.word)}</span>
  <small>${esc(plainReason(p))}${p.reviewNote ? ` · ${esc(p.reviewNote)}` : ""}</small></li>`;

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
$("league").textContent = `For context only: a typical jump score at this level is about ${league.value} ${league.unit} (${league.label}).`;

function row(p) {
  const pct = p.rsi.pct;
  const gate = day.noise_gate.rsi_mod && p.rsi.mean ? day.noise_gate.rsi_mod / p.rsi.mean * 100 : null;
  const zone = gate == null ? "" :
    `<span class="zone" style="left:${jumpPosition(-gate)}%;width:${jumpPosition(gate) - jumpPosition(-gate)}%"></span>`;
  const stale = isStale(p) ? " dot-stale" : "";
  const dot = pct == null ? "" : `<span class="dot dot-${esc(p.status)}${stale}" style="left:${jumpPosition(pct)}%"></span>`;
  return `<div class="band-row"><div>${esc(p.name)}<small>${esc(p.pos)}</small></div>
    <div class="track">${zone}<span class="normal"></span>${dot}</div>
    <div><span class="word-${esc(p.status)}">${esc(p.word)}</span><small>${esc(plainChange(p))}</small>${
      p.reviewNote ? `<small class="note">${esc(p.reviewNote)}</small>` : ""}</div></div>`;
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
  for (const p of players) $("board").querySelector(`.peg[data-id="${CSS.escape(p.id)}"]`)?.setAttribute("data-status", p.status);
} catch {
  $("board").textContent = "Board figure not built yet.";
}

import {
  applyDecisions, countByStatus, disclaimer, groupCheckins, hiddenSummary, isStale, jumpPosition, plainChange,
  plainReason, plainSummary, shortDate, sourcesNote, WORDS,
} from "./logic.js";
import { hasSavedReview, loadReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GROUPS = [["SP", "Starters"], ["RP", "Relievers"], ["C", "Catchers"], ["IF", "Infield"], ["OF", "Outfield"]];
const STATUSES = ["check_in", "watch", "no_change", "not_enough_data"];
const MEANING = { check_in: "Talk with him before he trains.", watch: "Keep an eye on him today." };
const FLAG = new Set(["check_in", "watch"]);

// One status mark, used everywhere: glyph + word, never colour alone.
const glyph = (s) => `<span class="glyph g-${esc(s)}" aria-hidden="true"></span>`;
const status = (p) => `<span class="status">${glyph(p.status)}<span class="word word-${esc(p.status)}">${esc(p.word)}</span></span>`;

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

// Labels: "Fictional roster" only on the demo; a line when a source did not update this morning.
const synthetic = day.synthetic === true;
$("disclaimer").textContent = disclaimer(day);
$("fiction-foot").hidden = !synthetic;
$("stale").textContent = sourcesNote(day);
$("stale").hidden = !sourcesNote(day);

const sched = day.schedule;
$("meta").textContent = `${day.club}. ${shortDate(date)}, ${date.slice(0, 4)}. ` +
  `${sched.home_away === "away" ? "Away at" : "Home vs"} ${sched.opponent}.`;
$("reviewed").textContent = review.approvedAt
  ? `Reviewed by ${review.reviewer}${example ? " (example review)" : ""}.` : "";
$("unreviewed").hidden = Boolean(review.approvedAt);

// ---- today at a glance ----
const counts = countByStatus(players);
$("tiles").innerHTML = STATUSES.map((s) => `<div class="tile tile-${s}${counts[s] && FLAG.has(s) ? " tile-on" : ""}">
  <span class="tile-n">${counts[s]}</span>${glyph(s)}<span class="tile-word">${WORDS[s]}</span></div>`).join("");

// ---- check-in action cards ----
const shift = day.team_shift;
const groups = groupCheckins(players, shift);
const flagged = [...groups.more, ...groups.withTeam];
const shiftText = shift
  ? `Whole team jumping ${Math.abs(Math.round(shift.median_pct))}% ${shift.median_pct < 0 ? "below" : "above"} normal (${shift.n} players tested).${sched.note ? ` ${sched.note}.` : ""}`
  : "";
const actionCard = (p) => `<article class="action action-${esc(p.status)}">
  <div class="action-top"><h3>${esc(p.name)}</h3><span class="pos">${esc(p.pos)}</span>${status(p)}</div>
  <p class="reason">${esc(plainReason(p))}</p>
  <p class="meaning">${esc(MEANING[p.status] ?? "")}</p>
  ${p.reviewNote ? `<p class="note">${esc(p.reviewNote)}</p>` : ""}</article>`;

if (groups.lead) {
  // Team-shift day: the team line leads, then who dropped more than the team, then a names-only line.
  $("shift-lead").textContent = shiftText;
  $("shift-lead").hidden = false;
  $("more-label").hidden = false;
  $("checkin").innerHTML = groups.more.length ? groups.more.map(actionCard).join("")
    : `<p class="nobody">Nobody is down more than the team.</p>`;
  $("with-team").textContent = groups.withTeam.length
    ? `Down with the team (${groups.withTeam.length}): ${groups.withTeam.map((p) => p.name).join(", ")}.`
    : "";
} else {
  $("checkin").innerHTML = flagged.length ? flagged.map(actionCard).join("")
    : `<p class="nobody">Nobody needs a check-in today.</p>`;
}

// The league figure is illustrative, so it is shown on the fictional demo only.
const league = day.league_reference.rsi_mod;
$("league").textContent = synthetic
  ? `For context only: a typical jump score at this level is about ${league.value} ${league.unit} (${league.label}).` : "";

// ---- roster rows ----
const gatePct = (p) => (day.noise_gate.rsi_mod && p.rsi.mean ? day.noise_gate.rsi_mod / p.rsi.mean * 100 : null);

function row(p) {
  const pct = p.rsi.pct;
  const gate = gatePct(p);
  const zone = gate == null ? "" :
    `<span class="zone" style="left:${jumpPosition(-gate)}%;width:${jumpPosition(gate) - jumpPosition(-gate)}%"></span>`;
  const stale = isStale(p) ? " dot-stale" : "";
  const dot = pct == null ? "" : `<span class="dot dot-${esc(p.status)}${stale}" style="left:${jumpPosition(pct)}%"></span>`;
  return `<div class="band-row row-${esc(p.status)}"><div class="who">${esc(p.name)} <span class="pos">${esc(p.pos)}</span></div>
    <div class="track">${zone}<span class="normal"></span>${dot}</div>
    <div class="row-status">${status(p)}<small>${esc(plainChange(p))}</small>${
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

// ---- two-week trend, in percent of his normal on the same scale as the rows ----
const W = 140, H = 36, PAD = 3;
const yOf = (pct) => H / 2 - Math.max(-20, Math.min(20, pct)) / 20 * (H / 2 - PAD);
function spark(p) {
  if (!p.rsi.mean || !p.rsi.sd) return "";
  const n = p.trend.length;
  const xOf = (i) => PAD + i * (W - 2 * PAD) / Math.max(1, n - 1);
  const pts = p.trend.map((t, i) => (t.z == null ? null : [xOf(i), yOf(t.z * p.rsi.sd / p.rsi.mean * 100)]));
  const path = pts.filter(Boolean).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const gate = gatePct(p) ?? 0;
  const last = pts[n - 1];
  // The last point is an HTML dot over the stretched SVG, so it stays round at any width.
  const lastDot = last ? `<span class="spark-last spark-${esc(p.status)}" style="left:${(last[0] / W * 100).toFixed(1)}%;top:${(last[1] / H * 100).toFixed(1)}%"></span>` : "";
  return `<div class="spark"><span class="who">${esc(p.name)} <span class="pos">${esc(p.pos)}</span></span>
    <div><div class="spark-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(p.name)}: jump each day for the last two weeks">
      <rect class="spark-band" x="0" y="${yOf(gate).toFixed(1)}" width="${W}" height="${(yOf(-gate) - yOf(gate)).toFixed(1)}"/>
      <line class="spark-normal" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>
      <path class="spark-line" d="${path}"/></svg>${lastDot}</div>
    <div class="spark-axis" aria-hidden="true"><span>2 weeks ago</span><span>today</span></div></div></div>`;
}
$("trends").innerHTML = flagged.slice(0, 5).map(spark).join("") || `<p class="nobody">No flagged players today.</p>`;

// ---- availability board (drawn for the fictional roster, so demo only) ----
async function drawBoard() {
  if (!synthetic) {
    $("board").textContent = "Board available in the demo only.";
    document.querySelector(".board-key").hidden = true;
    return;
  }
  try {
    const res = await fetch("figures/board/board.svg");
    if (!res.ok) throw new Error("no board");
    $("board").innerHTML = await res.text();
    for (const p of players) $("board").querySelector(`.peg[data-id="${CSS.escape(p.id)}"]`)?.setAttribute("data-status", p.status);
  } catch {
    $("board").textContent = "Board figure not built yet.";
  }
}
await drawBoard();

// ---- share bar ----
const say = (text) => { $("share-msg").textContent = text; };
$("print").addEventListener("click", () => print());

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

let copyTimer;
$("copy").addEventListener("click", async () => {
  const ok = await copyText(plainSummary(day, players, todayIds));
  const btn = $("copy");
  btn.textContent = ok ? "Copied" : "Could not copy";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { btn.textContent = "Copy for group text"; }, 2000);
});

const LIB = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
function loadLib() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = LIB;
    s.onload = () => (window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error("library missing")));
    s.onerror = () => reject(new Error("library did not load"));
    document.head.appendChild(s);
  });
}

$("save").addEventListener("click", async () => {
  const btn = $("save");
  btn.disabled = true;
  say("Making the image...");
  try {
    const lib = await loadLib();
    const keep = (node) => !(node.classList && (node.classList.contains("noprint") || node.classList.contains("banner")));
    const blob = await lib.toBlob($("card"), {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: keep,
    });
    if (!blob) throw new Error("empty image");
    const name = `lineup-card-${date}.png`;
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Lineup Card ${shortDate(date)}` });
      } catch (e) {
        if (e?.name !== "AbortError") throw e;
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    say("");
  } catch {
    say("Could not make the image here. Use Print / PDF.");
  } finally {
    btn.disabled = false;
  }
});

import {
  ACTION, applyDecisions, disclaimer, groupCheckins, headline, plainChange, plainSummary, printLayout, reasonLines,
  byJumpChange, rosterForm, rosterJump, rosterLabel, shortDate, sourcesNote, topLine, trendSvg,
} from "./logic.js";
import { hasSavedReview, loadReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GROUPS = [["SP", "Starters"], ["RP", "Relievers"], ["C", "Catchers"], ["IF", "Infield"], ["OF", "Outfield"]];

// One status mark, used everywhere: glyph + word, never colour alone.
const glyph = (s) => `<span class="glyph g-${esc(s)}" aria-hidden="true"></span>`;
const status = (p) => `<span class="status">${glyph(p.status)}<span class="word word-${esc(p.status)}">${esc(p.word)}</span></span>`;

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

const LIB = "vendor/html-to-image.js";   // shipped in the repo; no outside host
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

export async function init(src) {
  const index = await src.getIndex();
  const date = new URLSearchParams(location.search).get("date") ?? index.latest;
  const day = await src.getDay(date);
  let review = loadReview(date, src.scope);
  let example = false;
  if (!hasSavedReview(date, src.scope)) {
    // Only a visitor with nothing saved for this date sees the bundled example, labeled as such.
    // A partial or unapproved review of their own is shown as theirs, under the "Not reviewed yet" banner.
    const ex = await src.getExample(date);
    if (ex) { review = ex; example = true; }
  }
  document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    src.go(a.dataset.go, date);
  }));
  const players = applyDecisions(day.players, review.decisions);
  const todayIds = review.todayIds.length ? review.todayIds : players.map((p) => p.id);
  const inLineup = new Set(todayIds);
  const lineupKnown = review.todayIds.length > 0;

  // ---- top line, review state, labels ----
  const synthetic = day.synthetic === true;
  $("disclaimer").textContent = disclaimer(day);
  $("fiction-foot").hidden = !synthetic;
  $("topline").innerHTML = esc(topLine(day, date)).replace(/^Lineup Card/, "<strong>Lineup Card</strong>");
  $("reviewed").textContent = review.approvedAt
    ? `Reviewed by ${review.reviewer}${example ? " (example review)" : ""}.` : "";
  $("unreviewed").hidden = Boolean(review.approvedAt);
  $("sample-banner").hidden = !(example && review.approvedAt);

  // ---- the headline ----
  const h = headline(day, players);
  $("headline").textContent = h.title;
  $("subline").textContent = h.sub;
  const shift = day.team_shift;
  const note = shift?.beyond_noise && day.schedule?.note ? `${day.schedule.note.replace(/\.$/, "")}.` : "";
  $("schedule-note").textContent = note;
  $("schedule-note").hidden = !note;
  $("stale").textContent = sourcesNote(day);
  $("stale").hidden = !sourcesNote(day);

  // ---- one box per flagged player ----
  const groups = groupCheckins(players, shift);
  const box = (p) => {
    const away = lineupKnown && !inLineup.has(p.id) ? `<p class="away">Not in today's lineup</p>` : "";
    return `<article class="box box-${esc(p.status)}">
      <div class="box-top"><h2>${esc(p.name)} <span class="pos">${esc(p.pos)}</span></h2>${status(p)}</div>
      <div class="box-body">
        <div class="box-text">
          <ul class="reasons">${reasonLines(p).map((r) => `<li${r === p.reviewNote ? ' class="review-note"' : ""}>${esc(r)}</li>`).join("")}</ul>
          ${away}
          <p class="action">${esc(ACTION[p.status] ?? "")}</p>
        </div>
        <figure class="box-trend"><figcaption>Jump, last 2 weeks</figcaption>${trendSvg(p)}</figure>
      </div></article>`;
  };
  $("boxes").innerHTML = groups.more.map(box).join("");
  // The printed page makes room by box count (printLayout in logic.js).
  const layout = printLayout(groups.more.length);
  $("card").dataset.density = layout.density;
  $("card").dataset.pictures = String(layout.pictures);
  $("card").dataset.reasons = String(layout.reasons);
  $("card").dataset.roster = String(layout.roster);
  $("card").style.setProperty("--row-gap", `${layout.rowGap}pt`);
  // With 7 or more boxes the printed boxes become a list; one line says what each status asks for.
  $("tight-legend").textContent = `Check in: ${ACTION.check_in.toLowerCase()} Watch: ${ACTION.watch.toLowerCase()}`;
  $("more-label").hidden = !(groups.lead && groups.more.length);
  $("with-team").textContent = groups.withTeam.length
    ? `Down with the team: ${groups.withTeam.map((p) => p.name).join(", ")}.` : "";

  // ---- everyone, behind one button; in print the list always shows ----
  // On a team-drop day a flag the drop explains reads "Down with team" here (rosterLabel).
  const label = (p) => {
    const l = rosterLabel(p, shift);
    return `<span class="status">${glyph(l.kind)}<span class="word word-${esc(l.kind)}">${esc(l.word)}</span></span>`;
  };
  const row = (p) => `<li class="all-row">
      <span class="all-name">${esc(p.name)} <span class="pos">${esc(p.pos)}</span></span>${label(p)}
      <span class="all-change">${esc(plainChange(p))}</span><span class="in-lineup">${
      lineupKnown && inLineup.has(p.id) ? "in lineup" : ""}</span></li>`;
  $("all").innerHTML = GROUPS.map(([pos, label]) => {
    const rows = players.filter((p) => p.pos === pos).sort(byJumpChange);
    return rows.length ? `<div class="all-group"><h3>${label}</h3><ul>${rows.map(row).join("")}</ul></div>` : "";
  }).join("");
  // ---- the printed roster: two balanced tables of short columns, grouped by position ----
  const groupsByPos = GROUPS.map(([pos, name]) => [name, players.filter((p) => p.pos === pos).sort(byJumpChange)]).filter(([, r]) => r.length);
  const size = (gs) => gs.reduce((n, [, r]) => n + r.length + 1, 0);
  let split = 1;
  for (let i = 1; i < groupsByPos.length; i++) {
    const diff = (k) => Math.abs(size(groupsByPos.slice(0, k)) - size(groupsByPos.slice(k)));
    if (diff(i) < diff(split)) split = i;
  }
  const table = (gs) => `<table class="roster-table${lineupKnown ? " with-lineup" : ""}"><thead><tr><th>Player</th><th>Status</th><th>Jump vs usual</th>
      <th>Form</th>${lineupKnown ? "<th>Lineup</th>" : ""}</tr></thead><tbody>${gs.map(([name, rows]) =>
      `<tr class="grp"><th colspan="${lineupKnown ? 5 : 4}">${esc(name)}</th></tr>${rows.map((p) => `<tr>
        <td class="rt-name">${esc(p.name)}</td><td>${label(p)}</td>
        <td>${esc(rosterJump(p))}</td><td>${esc(rosterForm(p))}</td>${
        lineupKnown ? `<td>${inLineup.has(p.id) ? "yes" : ""}</td>` : ""}</tr>`).join("")}`).join("")}</tbody></table>`;
  $("roster-print").innerHTML = table(groupsByPos.slice(0, split)) + table(groupsByPos.slice(split));

  const showLabel = `Show all ${players.length} players`;
  $("toggle").textContent = showLabel;
  $("toggle").addEventListener("click", () => {
    const open = $("all").hidden;
    $("all").hidden = !open;
    $("toggle").textContent = open ? "Hide the list" : showLabel;
    $("toggle").setAttribute("aria-expanded", String(open));
  });

  // ---- share bar ----
  const say = (text) => { $("share-msg").textContent = text; };
  // "Save PDF": the print window's Save as PDF takes its file name from the page title.
  const pdfTitle = `Lineup Card ${day.club ? `${day.club} ` : ""}${date}`;
  let pageTitle = document.title;
  addEventListener("beforeprint", () => {
    if (document.title !== pdfTitle) pageTitle = document.title;
    document.title = pdfTitle;
  });
  addEventListener("afterprint", () => { document.title = pageTitle; });
  $("print").addEventListener("click", () => print());

  let copyTimer;
  $("copy").addEventListener("click", async () => {
    const ok = await copyText(plainSummary(day, players, todayIds, { reviewed: Boolean(review.approvedAt) }));
    const btn = $("copy");
    btn.textContent = ok ? "Copied" : "Could not copy";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { btn.textContent = "Copy for group text"; }, 2000);
  });

  $("save").addEventListener("click", async () => {
    const btn = $("save");
    btn.disabled = true;
    say("Making the image...");
    try {
      const lib = await loadLib();
      const keep = (node) => !(node.classList && (node.classList.contains("noprint") || node.classList.contains("banner")));
      // Capture the card at its own size; without this its centring margin is copied
      // into the image and pushes the right side out of frame. While capturing, the buttons
      // and banners are taken out of the layout so they leave no gaps in the image.
      const card = $("card");
      card.classList.add("capturing");
      const width = Math.ceil(Math.max(card.scrollWidth, card.getBoundingClientRect().width));
      const height = Math.ceil(Math.max(card.scrollHeight, card.getBoundingClientRect().height));
      const blob = await lib.toBlob(card, {
        width,
        height,
        style: { margin: "0" },
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
      say("Could not make the image here. Use Save PDF.");
    } finally {
      $("card").classList.remove("capturing");
      btn.disabled = false;
    }
  });

  // The club's own record of who approved what, as a file. The bundled example is not
  // anyone's record, so it cannot be exported.
  if (example) {
    $("export").disabled = true;
    $("export").title = "Example review: approve your own review to export it";
  }
  $("export").addEventListener("click", () => {
    const name = `lineup-card-review-${date}.json`;
    const blob = new Blob([JSON.stringify({ date, club: day.club, review }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

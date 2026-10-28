import { FLAGGED, WORDS, disclaimer, parseLineup, reasonLines, signalLine, sourcesNote } from "./logic.js";
import { emptyReview, hasSavedReview, loadReview, saveReview } from "./store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MEASURES = [["rsi_mod", "rsi", "RSI-mod", "m/s", 3], ["wellness_score", "wellness", "Wellness", "pts", 2]];

export async function init(src) {
  let day, review;

  async function load(date) {
    day = await src.getDay(date);
    review = hasSavedReview(date, src.scope) ? loadReview(date, src.scope) : emptyReview(src.reviewer);
    if (!hasSavedReview(date, src.scope)) {
      // The fictional sample comes with an example review: show how it was checked (its lineup and
      // decisions), not yet approved, so approving it makes it this reviewer's own.
      const ex = await src.getExample?.(date);
      if (ex) review = { ...emptyReview(src.reviewer), todayIds: ex.todayIds, decisions: ex.decisions };
    }
    $("disclaimer").textContent = disclaimer(day);
    $("stale").textContent = sourcesNote(day);
    $("stale").hidden = !sourcesNote(day);
    const names = day.players.filter((p) => review.todayIds.includes(p.id)).map((p) => p.name);
    $("lineup").value = names.join("\n");
    render();
  }


  function renderSignal() {
    const rows = MEASURES.map(([key, , label, unit, dp]) => {
      const s = day.signal[key];
      if (!s) return `<tr><td>${label}</td><td colspan="7">not enough data yet</td></tr>`;
      return `<tr><td>${label} (${unit})</td><td>${s.te.toFixed(dp)}</td><td>${s.cv_pct}%</td><td>${s.swc.toFixed(dp)}</td>
        <td>${s.swc_te} (${esc(s.rating)})</td><td>${s.mdc95.toFixed(dp)}</td><td>${s.gate.toFixed(dp)}</td><td>${s.n}</td></tr>`;
    }).join("");
    $("signal").innerHTML = `<div class="scroll"><table class="num"><thead><tr><th>Measure</th><th>TE</th><th>CV</th><th>SWC</th>
      <th>SWC ÷ TE</th><th>MDC95</th><th>Your gate</th><th>n</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><small>SWC ÷ TE below 1 means one reading cannot settle a change as small as the SWC. Bands (a convention): 1 or more good, 0.5 or more OK, below 0.5 marginal.</small></p>`;
    const cell = (d, dp) => d.change == null ? "<td>–</td><td>–</td><td>–</td><td>–</td>"
      : `<td>${d.change.toFixed(dp)}</td><td>${d.pct.toFixed(1)}%</td><td>${d.change_te ?? "–"}</td><td>${d.z.toFixed(2)}</td>`;
    $("allnums").innerHTML = `<div class="scroll"><table class="num"><thead><tr><th>Player</th><th>Status</th>
      <th>Jump Δ</th><th>%</th><th>TE units</th><th>z</th><th>Wellness Δ</th><th>%</th><th>TE units</th><th>z</th></tr></thead><tbody>${
      day.players.map((p) => `<tr><td>${esc(p.name)} ${esc(p.pos)}</td><td>${esc(p.word)}</td>${cell(p.rsi, 3)}${cell(p.wellness, 1)}</tr>`).join("")
    }</tbody></table></div>`;
  }

  function render() {
    renderSignal();
    $("held").innerHTML = day.held_out.length
      ? `<h3>Not matched (held out)</h3><ul class="plain">${day.held_out.map((h) =>
          `<li>${esc(h.source)}: "${esc(h.raw)}" (${esc(h.reason)})</li>`).join("")}</ul>`
      : "<p>Every row matched a player.</p>";
    $("log").innerHTML = day.cleaning_log.length
      ? `<h3>Cleaning decisions today</h3><ul class="plain">${day.cleaning_log.map((e) =>
          `<li>${esc(e.lc_id)} · ${esc(e.source)} · ${esc(e.detail)}</li>`).join("")}</ul>`
      : "<p>No cleaning decisions today.</p>";

    const flagged = day.players.filter((p) => FLAGGED.has(p.status));
    $("flags").innerHTML = flagged.length ? flagged.map((p) => {
      const d = review.decisions[p.id];
      const state = d ? `<small>Decision: ${esc(d.action)}${d.note ? ` · ${esc(d.note)}` : ""}</small>` : "";
      return `<div class="row" data-id="${esc(p.id)}">
        <div><strong>${esc(p.name)}</strong> ${esc(p.pos)} · <span class="word-${esc(p.status)}">${esc(p.word)}</span>
          <span class="plain">${reasonLines(p).map(esc).join(". ")}.</span>
          <small>${p.reasons.map(esc).join("; ")}</small>
          <small>${esc(signalLine("RSI-mod", "m/s", p.rsi))}</small><small>${esc(signalLine("Wellness", "pts", p.wellness, 1))}</small>${state}
          <span class="err" data-err></span></div>
        <div class="actions">
          <button data-act="confirm">Confirm</button>
          <select data-status aria-label="New status">${Object.entries(WORDS).filter(([k]) => k !== p.status)
            .map(([k, w]) => `<option value="${k}">${w}</option>`).join("")}</select>
          <input data-note placeholder="Note (required to change or remove)" aria-label="Note">
          <button data-act="change">Change</button>
          <button data-act="remove">Remove flag</button>
        </div></div>`;
    }).join("") : "<p>No flags today.</p>";
  }

  $("flags").addEventListener("click", (event) => {
    const act = event.target.dataset.act;
    if (!act) return;
    const row = event.target.closest(".row");
    const note = row.querySelector("[data-note]").value.trim();
    const err = row.querySelector("[data-err]");
    if (act !== "confirm" && !note) { err.textContent = "Add a note first."; return; }
    review.decisions[row.dataset.id] = act === "change"
      ? { action: "change", status: row.querySelector("[data-status]").value, note }
      : { action: act, note };
    review.approvedAt = null;
    saveReview(day.date, review, src.scope);
    render();
  });

  $("apply-lineup").addEventListener("click", () => {
    const { ids, unmatched } = parseLineup($("lineup").value, day.players);
    review.todayIds = ids;
    review.approvedAt = null;
    saveReview(day.date, review, src.scope);
    $("lineup-result").textContent = `${ids.length} players marked for today.` +
      (unmatched.length ? ` Not found: ${unmatched.join(", ")}.` : "");
  });

  $("approve").addEventListener("click", () => {
    const open = day.players.filter((p) => FLAGGED.has(p.status) && !review.decisions[p.id]);
    if (!review.todayIds.length) { $("approve-msg").textContent = "Mark today's players first."; return; }
    if (open.length) { $("approve-msg").textContent = `Decide on every flag first (${open.length} left).`; return; }
    // The approval belongs to whoever clicked Approve, even on a review someone else started.
    review.reviewer = src.reviewer;
    review.approvedAt = new Date().toISOString();
    if (!saveReview(day.date, review, src.scope)) {
      review.approvedAt = null;
      $("approve-msg").textContent = "Could not save this review in this browser.";
      return;
    }
    $("approve-msg").textContent = "";
    src.go("card", day.date);
  });

  const index = await src.getIndex();
  $("date").innerHTML = index.dates.map((d) => `<option ${d === index.latest ? "selected" : ""}>${d}</option>`).join("");
  $("date").addEventListener("change", (e) => load(e.target.value));
  load(index.latest);
}

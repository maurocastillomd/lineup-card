// Offline edition: CSVs in, review and card out, all in this browser tab.
// Dropped files are kept in memory only; saved reviews use localStorage,
// scoped by club name, and "Forget" clears them. The sample runs under the
// fictional club's name, so it never mixes with a real club's reviews.

import { buildDays, sortFiles } from "./core/run.mjs";
import { init as initCard } from "./card.js";
import { init as initReview } from "./review.js";
import { clearReviews } from "./store.js";
import { filesFromEntries, filesFromPicker } from "./folders.js";
import { SAMPLE, SAMPLE_CLUB, SAMPLE_EXAMPLE } from "./sample-data.js";

const app = document.getElementById("app");
const firstHash = location.hash;
let built = null;      // { index, days, club, synthetic }

const UTF8_HELP = "not saved as UTF-8. In Excel use Save As > CSV UTF-8 (Comma delimited).";

// Dev only: the build fills these templates; served unbundled, fetch the page bodies.
async function fillTemplates() {
  for (const tpl of document.querySelectorAll("template[data-from]")) {
    if (tpl.content.childNodes.length) continue;
    const html = await (await fetch(tpl.dataset.from)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    tpl.innerHTML = doc.body.innerHTML;
  }
}

// Only the current screen's stylesheet is on (card.css also styles plain <section>s).
function sheets(id) {
  const on = { "css-card": id === "tpl-card", "css-review": id === "tpl-review" };
  for (const [sheet, enabled] of Object.entries(on)) {
    const el = document.getElementById(sheet);
    if (el) el.disabled = !enabled;
  }
}

function show(id) {
  sheets(id);
  app.replaceChildren(document.getElementById(id).content.cloneNode(true));
  if (id !== "tpl-load") {
    const bar = Object.assign(document.createElement("div"), { className: "noprint start-bar" });
    const again = Object.assign(document.createElement("button"), { type: "button", className: "start-over", textContent: "Start over" });
    again.addEventListener("click", () => showLoad());
    bar.append(again);
    app.prepend(bar);
  }
  window.scrollTo(0, 0);
}

function source(reviewer) {
  return {
    scope: built.club,
    reviewer,
    getIndex: async () => built.index,
    getDay: async (date) => built.days[date],
    getExample: async (date) => (built.synthetic && SAMPLE_EXAMPLE.date === date ? structuredClone(SAMPLE_EXAMPLE.review) : null),
    go: (screen, date) => route(screen, date, reviewer),
  };
}

function route(screen, date, reviewer) {
  if (screen === "load") return showLoad();
  history.replaceState(null, "", `#${screen}${date ? `:${date}` : ""}`);
  show(screen === "card" ? "tpl-card" : "tpl-review");
  const src = source(reviewer);
  const at = date ? { ...src, getIndex: async () => ({ ...built.index, latest: date }) } : src;
  return screen === "card" ? initCard(at) : initReview(at);
}

// Read one dropped File as strict UTF-8. Returns { file } or { problem }.
export async function readFile(f) {
  if (!/\.csv$/i.test(f.name)) return { problem: `${f.name}: not a CSV file, skipped`, skip: true };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await f.arrayBuffer());
    return { file: { name: f.name, text } };
  } catch {
    return { problem: `${f.name}: ${UTF8_HELP}` };
  }
}

let takeFiles = null;   // the load screen's file intake, exposed for hand checks

function showLoad() {
  show("tpl-load");
  history.replaceState(null, "", "#load");
  const $ = (id) => document.getElementById(id);
  let files = [];
  let readProblems = [];
  const say = (lines) => { $("problems").textContent = lines.join("\n"); };
  const list = () => {
    let sorted;
    try {
      sorted = sortFiles(files);
    } catch (e) {
      sorted = { kinds: {}, problems: String(e.message).split("\n") };
    }
    const items = [];
    for (const [kind, kindFiles] of Object.entries(sorted.kinds)) {
      for (const f of kindFiles) {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = kind;
        li.append(b, ` ${f.name}`);
        items.push(li);
      }
    }
    $("found").replaceChildren(...items);
    say(files.length || readProblems.length ? [...readProblems.map((p) => p.text), ...sorted.problems] : []);
  };
  const take = async (fileList) => {
    for (const f of Array.from(fileList)) {
      const { file, problem, skip } = await readFile(f);
      if (problem) {
        if (!readProblems.some((p) => p.text === problem)) readProblems.push({ text: problem, blocks: !skip });
        continue;
      }
      // The same file dropped twice counts once; same-named files from different days are kept.
      if (!files.some((g) => g.name === file.name && g.text === file.text)) files.push(file);
    }
    list();
  };
  takeFiles = take;
  $("files").addEventListener("change", (e) => { take(e.target.files); e.target.value = ""; });
  $("drop").addEventListener("click", () => $("files").click());
  $("drop").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("files").click(); }
  });
  $("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
  $("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
  $("drop").addEventListener("drop", async (e) => {
    e.preventDefault();
    $("drop").classList.remove("over");
    // Read the entries now: the browser empties the drop's item list once this handler returns.
    const plain = Array.from(e.dataTransfer.files);
    const entries = Array.from(e.dataTransfer.items ?? [], (i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null));
    // Plain files go the plain way. Chrome refuses entry reads on a page opened from disk,
    // so a folder is tried through its entries and, if refused, the user is sent to the folder button.
    if (!entries.some((en) => en?.isDirectory)) return take(plain);
    try {
      take(await filesFromEntries(entries.filter(Boolean)));
    } catch {
      say(['This browser cannot read a dropped folder here. Click "Choose a folder" instead, or drop the files themselves.']);
    }
  });
  $("folder").addEventListener("change", (e) => { take(filesFromPicker(e.target.files)); e.target.value = ""; });
  $("choose-folder").addEventListener("click", () => $("folder").click());
  $("clear").addEventListener("click", () => { files = []; readProblems = []; list(); });
  // The sample opens straight on the finished card (with its example review); real files open
  // the review first, because a person must approve before staff see a card.
  const start = (theFiles, club, { sample = false } = {}) => {
    const reviewer = $("reviewer").value.trim() || (sample ? "Sample reviewer" : "");
    if (!club.name || !reviewer) return say(["Type the club name and your name first."]);
    const blocking = theFiles === files ? readProblems.filter((p) => p.blocks).map((p) => p.text) : [];
    if (blocking.length) return say([...blocking, "Save these again as CSV UTF-8, then Clear the file list and drop them all again."]);
    try {
      built = { ...buildDays(theFiles, club), club: club.name, synthetic: club.synthetic };
    } catch (e) {
      return say(String(e.message).split("\n"));
    }
    if (!built.index.dates.length) return say(["No day in these files has any data rows."]);
    route(sample ? "card" : "review", built.index.latest, reviewer);
  };
  $("go").addEventListener("click", () => start(files, { name: $("club").value.trim(), synthetic: false }));
  $("sample").addEventListener("click", () => start(SAMPLE, SAMPLE_CLUB, { sample: true }));
  $("forget").addEventListener("click", () => {
    const club = $("club").value.trim();
    if (!club) return say(["Type the club name whose saved reviews you want to forget."]);
    say([`Forgot ${clearReviews(club)} saved review(s) for ${club} on this computer.`]);
  });
}

// For hand checks only: feed File objects through the same path as a drop.
export const dropFiles = (fileList) => takeFiles?.(fileList);

await fillTemplates();
showLoad();
if (firstHash === "#autosample") {         // test hook (offline smoke test)
  document.getElementById("reviewer").value = "Test";
  document.getElementById("sample").click();
}

// Every button on a screen must be wired up by that screen's script.
// (The Print button once lost its handler in a refactor and did nothing.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WEB = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB), "utf8");
const buttonIds = (html) => [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const wired = (js, id) => js.includes(`$("${id}")`) || js.includes(`getElementById("${id}")`);

for (const [page, scripts] of [
  ["card.html", ["js/card.js"]],
  ["index.html", ["js/review.js"]],
  ["offline.html", ["js/offline.js"]],
]) {
  test(`every button in ${page} is wired up`, () => {
    const ids = buttonIds(read(page));
    assert.ok(ids.length > 0, `no buttons found in ${page}`);
    const js = scripts.map(read).join("\n");
    assert.deepEqual(ids.filter((id) => !wired(js, id)), []);
  });
}

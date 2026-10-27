// The pages may not load anything from another host: fonts and libraries ship
// in the repo. Links the user clicks (<a href>) are allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = new URL("../../web/", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f === "vendor" && dir.endsWith("board")) return [];      // anatomy kit build tooling, not loaded by pages
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const LOADS = /(@import\s+url\(|url\(\s*["']?|src\s*=\s*["']?|import\s*\(?\s*["']|fetch\(\s*["'`]|\bLIB\s*=\s*["'])https?:/i;

test("no web file loads anything from another host", () => {
  const bad = walk(WEB).filter((p) => /\.(html|css|js|mjs)$/.test(p) && !p.includes("/vendor/html-to-image"))
    .filter((p) => LOADS.test(readFileSync(p, "utf8")));
  assert.deepEqual(bad, []);
});

// Dropping a whole folder (or choosing one) reads every CSV inside, named "<folder>/<file>".
import { test } from "node:test";
import assert from "node:assert/strict";
import { filesFromEntries, filesFromPicker } from "../../web/js/folders.js";

const file = (name, text = name) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
const fileEntry = (name) => ({ name, isFile: true, isDirectory: false, file: (ok) => ok(file(name)) });
// readEntries hands out children two at a time, like Chrome's batches.
const dirEntry = (name, children) => ({
  name, isFile: false, isDirectory: true,
  createReader() {
    let i = 0;
    return { readEntries: (ok) => { const b = children.slice(i, i + 2); i += 2; ok(b); } };
  },
});

test("a dropped folder is read every level down, in name order, skipping hidden files", async () => {
  const tree = dirEntry("sample-data", [
    fileEntry("roster.csv"),
    fileEntry(".DS_Store"),
    dirEntry("2026-08-12", [fileEntry("wellness.csv"), fileEntry("vald_forcedecks_cmj.csv")]),
    dirEntry("2026-08-11", [fileEntry("vald_forcedecks_cmj.csv"), fileEntry("catapult_openfield.csv"), fileEntry("wellness.csv")]),
    dirEntry(".git", [fileEntry("config")]),
  ]);
  const files = await filesFromEntries([tree, fileEntry("schedule.csv")]);
  assert.deepEqual(files.map((f) => f.name), [
    "sample-data/2026-08-11/catapult_openfield.csv",
    "sample-data/2026-08-11/vald_forcedecks_cmj.csv",
    "sample-data/2026-08-11/wellness.csv",
    "sample-data/2026-08-12/vald_forcedecks_cmj.csv",
    "sample-data/2026-08-12/wellness.csv",
    "sample-data/roster.csv",
    "schedule.csv",
  ]);
  const text = new TextDecoder().decode(await files[0].arrayBuffer());
  assert.equal(text, "catapult_openfield.csv");
});

test("a chosen folder names files by their path and skips hidden ones", () => {
  const picked = [
    { ...file("roster.csv"), webkitRelativePath: "sample-data/roster.csv" },
    { ...file(".DS_Store"), webkitRelativePath: "sample-data/.DS_Store" },
    { ...file("wellness.csv"), webkitRelativePath: "sample-data/2026-08-11/wellness.csv" },
    file("loose.csv"),
  ];
  assert.deepEqual(filesFromPicker(picked).map((f) => f.name),
    ["sample-data/roster.csv", "sample-data/2026-08-11/wellness.csv", "loose.csv"]);
});

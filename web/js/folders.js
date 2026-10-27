// Folders in, files out. No DOM here, so node can test it with fake entries.
// A dropped folder is read every level down; each file is named "<folder>/<file>",
// so the same export name from different days stays apart and sorts by folder.
// Hidden files and folders (".DS_Store" and the like) are skipped.

const hidden = (name) => name.startsWith(".");
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// A File under another name. readFile needs only .name and .arrayBuffer().
export const renamed = (file, name) => (name === file.name ? file : { name, arrayBuffer: () => file.arrayBuffer() });

async function allEntries(dir) {
  const reader = dir.createReader();
  const out = [];
  // readEntries returns a batch at a time (100 in Chrome) until it returns none.
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return out;
    out.push(...batch);
  }
}

async function walk(entry, prefix) {
  if (hidden(entry.name)) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [renamed(file, `${prefix}${entry.name}`)];
  }
  if (!entry.isDirectory) return [];
  const out = [];
  for (const child of (await allEntries(entry)).sort(byName)) out.push(...await walk(child, `${prefix}${entry.name}/`));
  return out;
}

// Entries from DataTransferItem.webkitGetAsEntry(), files and folders mixed.
export async function filesFromEntries(entries) {
  const out = [];
  for (const entry of entries) out.push(...await walk(entry, ""));
  return out;
}

// Files from <input type="file" webkitdirectory>: named by their path inside the chosen folder.
export function filesFromPicker(fileList) {
  return Array.from(fileList)
    .filter((f) => !(f.webkitRelativePath || f.name).split("/").some(hidden))
    .map((f) => renamed(f, f.webkitRelativePath || f.name));
}

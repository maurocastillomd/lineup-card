// Saved reviews are scoped by club name. Clearing one club must never touch another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearReviews, reviewKey, saveReview, emptyReview } from "../../web/js/store.js";

function fakeStorage() {
  const mem = new Map();
  return {
    mem,
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

test("review keys: the demo keeps its old keys; a club name is encoded", () => {
  assert.equal(reviewKey("2026-09-20"), "lineupcard:review:2026-09-20");
  assert.equal(reviewKey("2026-09-20", ""), "lineupcard:review:2026-09-20");
  assert.equal(reviewKey("2026-09-20", "Club A"), "lineupcard:review:Club%20A:2026-09-20");
  assert.equal(reviewKey("2026-09-20", "A:B"), "lineupcard:review:A%3AB:2026-09-20");
});

test("clearing club A leaves club A:B alone", () => {
  const store = fakeStorage();
  globalThis.localStorage = store;
  try {
    saveReview("2026-09-20", emptyReview(), "A");
    saveReview("2026-09-21", emptyReview(), "A");
    saveReview("2026-09-20", emptyReview(), "A:B");
    saveReview("2026-09-20", emptyReview(), "");
    assert.equal(clearReviews("A"), 2);
    assert.deepEqual([...store.mem.keys()].sort(),
      [reviewKey("2026-09-20", ""), reviewKey("2026-09-20", "A:B")].sort());
    assert.equal(clearReviews("A:B"), 1);
    assert.deepEqual([...store.mem.keys()], [reviewKey("2026-09-20", "")]);
  } finally {
    delete globalThis.localStorage;
  }
});

test("clearing with no club name clears nothing", () => {
  const store = fakeStorage();
  globalThis.localStorage = store;
  try {
    saveReview("2026-09-20", emptyReview(), "");
    saveReview("2026-09-20", emptyReview(), "A");
    assert.equal(clearReviews(""), 0);
    assert.equal(store.mem.size, 2);
  } finally {
    delete globalThis.localStorage;
  }
});

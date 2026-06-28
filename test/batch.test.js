// Tests for the batch (5-saves-makes-a-block) logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleItems, nextBatch } from "../src/lib/batch.js";

// Helper to make a fake saved item quickly.
function item(id, { read = false, batchedAt = null, savedAt } = {}) {
  return { id, url: `https://x/${id}`, title: id, read, batchedAt, savedAt };
}

test("fewer than batchSize eligible → not ready", () => {
  const items = [item("a", { savedAt: "2026-01-01" }), item("b", { savedAt: "2026-01-02" })];
  const result = nextBatch(items, 5);
  assert.equal(result.ready, false);
  assert.deepEqual(result.batch, []);
});

test("exactly batchSize eligible → ready, oldest first", () => {
  const items = [
    item("e", { savedAt: "2026-01-05" }),
    item("a", { savedAt: "2026-01-01" }),
    item("c", { savedAt: "2026-01-03" }),
    item("b", { savedAt: "2026-01-02" }),
    item("d", { savedAt: "2026-01-04" }),
  ];
  const result = nextBatch(items, 5);
  assert.equal(result.ready, true);
  assert.deepEqual(result.batch.map((i) => i.id), ["a", "b", "c", "d", "e"]);
});

test("read and already-batched items are excluded", () => {
  const items = [
    item("a", { savedAt: "2026-01-01", read: true }), // read → excluded
    item("b", { savedAt: "2026-01-02", batchedAt: "2026-01-02" }), // batched → excluded
    item("c", { savedAt: "2026-01-03" }),
    item("d", { savedAt: "2026-01-04" }),
  ];
  assert.deepEqual(eligibleItems(items).map((i) => i.id), ["c", "d"]);
  assert.equal(nextBatch(items, 5).ready, false);
});

test("more than batchSize → only the oldest batchSize are taken", () => {
  const items = Array.from({ length: 7 }, (_, n) =>
    item(`i${n}`, { savedAt: `2026-01-0${n + 1}` })
  );
  const result = nextBatch(items, 5);
  assert.equal(result.ready, true);
  assert.equal(result.batch.length, 5);
  assert.deepEqual(result.batch.map((i) => i.id), ["i0", "i1", "i2", "i3", "i4"]);
});

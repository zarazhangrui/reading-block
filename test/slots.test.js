// Tests for the slot-finder (the scheduling brain).
// Anchored to the week of Monday 1 June 2026 (verified: that date is a Monday).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findNextFreeSlot, localDateKey } from "../src/lib/slots.js";

// Default preferences: weekdays, 2–6pm, 30-min block, look 14 days out.
const PREFS = {
  days: [1, 2, 3, 4, 5],
  windowStart: "14:00",
  windowEnd: "18:00",
  blockMinutes: 30,
  lookaheadDays: 14,
};

// Local-time date helper: month is 1-based here for readability.
const dt = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

test("totally free weekday → books the very start of the window", () => {
  const now = dt(2026, 6, 1, 10, 0); // Mon 10:00
  const slot = findNextFreeSlot([], PREFS, now);
  assert.equal(slot.start.getTime(), dt(2026, 6, 1, 14, 0).getTime());
  assert.equal(slot.end.getTime(), dt(2026, 6, 1, 14, 30).getTime());
});

test("a meeting at the window start pushes the block after it", () => {
  const now = dt(2026, 6, 1, 10, 0);
  const busy = [{ start: dt(2026, 6, 1, 14, 0), end: dt(2026, 6, 1, 15, 0) }];
  const slot = findNextFreeSlot(busy, PREFS, now);
  assert.equal(slot.start.getTime(), dt(2026, 6, 1, 15, 0).getTime());
});

test("when today's gaps are all too small, it rolls to the next day", () => {
  const now = dt(2026, 6, 1, 10, 0);
  // Monday: 14:00–16:00 busy, then only a 15-min gap, then busy to 18:00.
  const busy = [
    { start: dt(2026, 6, 1, 14, 0), end: dt(2026, 6, 1, 16, 0) },
    { start: dt(2026, 6, 1, 16, 15), end: dt(2026, 6, 1, 18, 0) },
  ];
  const slot = findNextFreeSlot(busy, PREFS, now);
  // Should jump to Tuesday 2 June at 14:00.
  assert.equal(slot.start.getTime(), dt(2026, 6, 2, 14, 0).getTime());
});

test("weekends are skipped", () => {
  const now = dt(2026, 6, 6, 10, 0); // Saturday 6 June
  const slot = findNextFreeSlot([], PREFS, now);
  // Next allowed day is Monday 8 June.
  assert.equal(slot.start.getTime(), dt(2026, 6, 8, 14, 0).getTime());
});

test("if it's too late in the day, it goes to tomorrow", () => {
  const now = dt(2026, 6, 1, 17, 45); // only 15 min left in today's window
  const slot = findNextFreeSlot([], PREFS, now);
  assert.equal(slot.start.getTime(), dt(2026, 6, 2, 14, 0).getTime());
});

test("now sitting exactly at the window start books immediately", () => {
  const now = dt(2026, 6, 1, 14, 0);
  const slot = findNextFreeSlot([], PREFS, now);
  assert.equal(slot.start.getTime(), dt(2026, 6, 1, 14, 0).getTime());
});

test("a day that already has a reading block is skipped (one per day)", () => {
  const now = dt(2026, 6, 1, 10, 0); // Mon, totally free
  const blocked = new Set([localDateKey(dt(2026, 6, 1))]); // Monday already booked
  const slot = findNextFreeSlot([], PREFS, now, blocked);
  // Even though Monday is wide open, it should jump to Tuesday.
  assert.equal(slot.start.getTime(), dt(2026, 6, 2, 14, 0).getTime());
});

test("no allowed days → returns null instead of guessing", () => {
  const slot = findNextFreeSlot([], { ...PREFS, days: [] }, dt(2026, 6, 1, 10, 0));
  assert.equal(slot, null);
});

test("returned slot never overlaps a busy interval (property check)", () => {
  const now = dt(2026, 6, 1, 9, 0);
  const busy = [
    { start: dt(2026, 6, 1, 14, 0), end: dt(2026, 6, 1, 14, 20) },
    { start: dt(2026, 6, 1, 14, 40), end: dt(2026, 6, 1, 18, 0) },
  ];
  const slot = findNextFreeSlot(busy, PREFS, now);
  // The only 20-min-too-short gaps are on Monday, so it should land Tuesday.
  assert.equal(slot.start.getTime(), dt(2026, 6, 2, 14, 0).getTime());
  for (const b of busy) {
    const overlaps = slot.start < b.end && slot.end > b.start;
    assert.equal(overlaps, false);
  }
});

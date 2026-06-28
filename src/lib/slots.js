// slots.js
// ---------------------------------------------------------------------------
// The "brain" of the scheduler. Given a list of times you're already busy and
// your preferences (which days, what afternoon window, how long a block), this
// figures out the NEXT free slot where a Focus Reading block could go.
//
// IMPORTANT: This file knows nothing about Chrome or Google. It's pure logic:
// data in, answer out. That's deliberate — it makes it easy to test with fake
// data (see test/slots.test.js) and impossible for it to accidentally touch
// your real calendar.
// ---------------------------------------------------------------------------

// Turn a value that might be a Date, an ISO string, or a number of milliseconds
// into a plain millisecond timestamp. We compare everything in milliseconds
// because that side-steps all timezone confusion (a moment in time is a moment
// in time, no matter how it's written).
function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime(); // handles ISO strings like Google sends
}

// Parse "14:00" into { hours: 14, minutes: 0 }.
function parseHHMM(text) {
  const [h, m] = text.split(":").map((n) => parseInt(n, 10));
  return { hours: h, minutes: m };
}

// Build a Date for a specific day-at-a-specific-clock-time, in the user's
// LOCAL timezone. We take an existing Date (which fixes the year/month/day in
// local time) and stamp the hours/minutes onto it. This is the only part that
// is timezone-aware, and it correctly uses the machine's local time — which is
// what "2pm" means to the person using it.
function atLocalTime(dayDate, hhmm) {
  const d = new Date(dayDate);
  d.setHours(hhmm.hours, hhmm.minutes, 0, 0);
  return d;
}

// A stable "which calendar day is this" key in LOCAL time, like "2026-6-29".
// Used to compare a candidate day against days that already have a block. We
// build it from local year/month/day so it lines up with how the user sees
// their calendar.
export function localDateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Find the next free slot.
 *
 * @param {Array<{start, end}>} busy  Intervals you're already booked. start/end
 *        may be Date, ISO string, or ms. (This is what Google's free/busy API
 *        gives us, already shaped to {start, end}.)
 * @param {Object} prefs
 * @param {number[]} prefs.days        Allowed weekdays. 0=Sunday … 6=Saturday.
 * @param {string}   prefs.windowStart "HH:MM" earliest the block may start.
 * @param {string}   prefs.windowEnd   "HH:MM" latest the block may END by.
 * @param {number}   prefs.blockMinutes  Length of the block in minutes.
 * @param {number}   prefs.lookaheadDays How many days ahead to search.
 * @param {Date|number|string} now     The current moment. Passed in (not read
 *        from the clock inside) so tests are deterministic.
 * @returns {{start: Date, end: Date} | null}  The slot, or null if none found.
 * @param {Set<string>} [blockedDayKeys]  Day keys ("YYYY-M-D") that already have
 *        a reading block and must be skipped entirely, so we never book two
 *        reading blocks on the same day.
 */
export function findNextFreeSlot(busy, prefs, now, blockedDayKeys = new Set()) {
  const nowMs = toMs(now);
  const blockMs = prefs.blockMinutes * 60 * 1000;
  const startPref = parseHHMM(prefs.windowStart);
  const endPref = parseHHMM(prefs.windowEnd);

  // Normalise busy intervals to ms once, up front.
  const busyMs = busy
    .map((b) => ({ start: toMs(b.start), end: toMs(b.end) }))
    .sort((a, b) => a.start - b.start);

  // Walk forward day by day, starting from today.
  const startDay = new Date(nowMs);
  startDay.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset <= prefs.lookaheadDays; dayOffset++) {
    // The calendar day we're examining.
    const day = new Date(startDay);
    day.setDate(startDay.getDate() + dayOffset);

    // Skip days the user didn't allow (e.g. weekends by default).
    if (!prefs.days.includes(day.getDay())) continue;

    // Skip days that already hold a reading block (one block per day, max).
    if (blockedDayKeys.has(localDateKey(day))) continue;

    // The bookable window for this specific day, as ms timestamps.
    const windowStartMs = atLocalTime(day, startPref).getTime();
    const windowEndMs = atLocalTime(day, endPref).getTime();

    // A "cursor" that walks across the day's free time. It can't start before
    // the window opens, and on today it can't start in the past.
    let cursor = Math.max(windowStartMs, nowMs);

    // If we've already missed this whole day's window, move on.
    if (cursor + blockMs > windowEndMs) continue;

    // Only the busy intervals that overlap today's window matter here.
    const todaysBusy = busyMs.filter(
      (b) => b.end > windowStartMs && b.start < windowEndMs
    );

    // Walk the cursor past each busy interval, looking for a gap big enough.
    let placed = null;
    for (const b of todaysBusy) {
      // Is there room between where we are and the next thing on the calendar?
      if (b.start - cursor >= blockMs) {
        placed = cursor;
        break;
      }
      // No room — jump the cursor to the end of this busy interval (but never
      // backwards, in case intervals overlap each other).
      cursor = Math.max(cursor, b.end);
      // If jumping forward pushed us out of the window, this day is done.
      if (cursor + blockMs > windowEndMs) {
        cursor = windowEndMs; // mark as "no room left today"
        break;
      }
    }

    // If we didn't slot it between busy blocks, maybe it fits after the last
    // one (or the day was totally free): check the tail of the window.
    if (placed === null && cursor + blockMs <= windowEndMs) {
      placed = cursor;
    }

    if (placed !== null) {
      return { start: new Date(placed), end: new Date(placed + blockMs) };
    }
  }

  // Searched the whole lookahead window and found nothing.
  return null;
}

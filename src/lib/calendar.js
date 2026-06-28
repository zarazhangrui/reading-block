// calendar.js
// ---------------------------------------------------------------------------
// The only file that talks to Google. It does three things:
//   1. Get permission (a "token") to use your Google Calendar.
//   2. Ask Google when you're busy over the next couple of weeks.
//   3. Create the "Focus Reading" event in the free slot we found.
//
// It delegates the actual "where should the block go?" decision to slots.js,
// which we've already tested. This file is just the messenger to Google.
// ---------------------------------------------------------------------------

import { findNextFreeSlot, localDateKey } from "./slots.js";

const CAL_API = "https://www.googleapis.com/calendar/v3";

// --- Permission (OAuth token via Chrome's built-in Google login) ------------

// Ask Chrome for a Google access token. `interactive: true` lets Chrome pop the
// Google consent screen the first time; after that it's silent and cached.
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "Could not get Google permission."));
      } else {
        resolve(token);
      }
    });
  });
}

// If Google rejects a token (e.g. it expired), drop it from Chrome's cache so
// the next getToken() fetches a fresh one.
function dropToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// A small wrapper around fetch that attaches the token and, if the token turns
// out to be stale (401), refreshes it once and retries. This is the standard
// recommended pattern for Chrome extensions.
async function callGoogle(path, options, interactive) {
  let token = await getToken(interactive);
  let res = await fetch(`${CAL_API}${path}`, withAuth(options, token));

  if (res.status === 401) {
    await dropToken(token);
    token = await getToken(interactive);
    res = await fetch(`${CAL_API}${path}`, withAuth(options, token));
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Calendar error ${res.status}: ${body.slice(0, 300)}`);
  }
  // Some calls (like a successful insert) return JSON; guard empty bodies.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function withAuth(options = {}, token) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

// --- The public function the rest of the app uses ---------------------------

/**
 * Find a free slot from the user's preferences and book a Focus Reading block.
 * @param {Array} batchItems  The (up to) 5 saved items to read; {url, title}.
 * @param {Object} settings   The user's preferences (from storage).
 * @param {Object} [opts]
 * @param {boolean} [opts.interactive=true]  Allow the Google consent popup.
 * @param {Date}    [opts.now=new Date()]    Injectable clock for testing.
 * @returns {Promise<{event, slot}>}
 * @throws if no free slot exists in the lookahead window, or Google errors.
 */
export async function scheduleReadingBlock(batchItems, settings, opts = {}) {
  const interactive = opts.interactive !== false;
  const now = opts.now || new Date();
  const calendarId = encodeURIComponent(settings.calendarId || "primary");

  // 1. Ask Google when we're busy across the lookahead window.
  const timeMin = new Date(now);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + settings.lookaheadDays + 1);

  const fb = await callGoogle(
    "/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: settings.calendarId || "primary" }],
      }),
    },
    interactive
  );

  const busy = fb.calendars?.[settings.calendarId || "primary"]?.busy || [];

  // 2. Find which days ALREADY have a reading block, so we never put two on the
  //    same day.
  const blockedDays = await getBlockedDays(settings, timeMin, timeMax, interactive);

  // 3. Use our tested brain to pick the slot, skipping any taken day.
  const slot = findNextFreeSlot(busy, settings, now, blockedDays);
  if (!slot) {
    throw new Error(
      `No free ${settings.blockMinutes}-minute slot found on a free day in your preferred window over the next ${settings.lookaheadDays} days.`
    );
  }

  // 4. Build the event, putting the 5 links in the description.
  const title = settings.eventTitle || "Reading Block";
  const description = buildDescription(batchItems);
  const event = await callGoogle(
    `/calendars/${calendarId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: title,
        description,
        start: { dateTime: slot.start.toISOString() },
        end: { dateTime: slot.end.toISOString() },
        // A subtle reminder pop-up 10 minutes before.
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      }),
    },
    interactive
  );

  return { event, slot };
}

// Ask Google which days in the window already hold one of OUR reading blocks
// (matched by the event title). Returns a Set of local day keys to skip.
async function getBlockedDays(settings, timeMin, timeMax, interactive) {
  const calendarId = encodeURIComponent(settings.calendarId || "primary");
  const title = settings.eventTitle || "Reading Block";
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    q: title,
    maxResults: "2500",
  });

  const data = await callGoogle(
    `/calendars/${calendarId}/events?${params.toString()}`,
    { method: "GET" },
    interactive
  );

  const days = new Set();
  for (const ev of data.items || []) {
    // q is a loose full-text match, so confirm the title really matches ours.
    if (ev.summary !== title) continue;
    const startsAt = ev.start?.dateTime || ev.start?.date;
    if (startsAt) days.add(localDateKey(startsAt));
  }
  return days;
}

// Delete a reading-block event (used when the user clicks Undo on a booking).
export async function deleteReadingEvent(eventId, settings, opts = {}) {
  const interactive = opts.interactive !== false;
  const calendarId = encodeURIComponent(settings.calendarId || "primary");
  await callGoogle(
    `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
    interactive
  );
}

// Format the saved items into a tidy, clickable description block.
function buildDescription(items) {
  const lines = items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.url}`);
  return ["Your reading list for this session:", "", ...lines, "", "Booked by Reading Block"].join("\n");
}

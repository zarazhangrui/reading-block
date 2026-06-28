// service-worker.js
// ---------------------------------------------------------------------------
// The background brain. It does three jobs now:
//   1. Left-click on the toolbar icon  -> save the current page instantly.
//   2. Right-click on the toolbar icon -> a menu to open the dashboard
//      (your reading list and settings, in a full browser tab).
//   3. When a save completes a batch of five, book the reading block.
//
// There's no popup, so saving is a single click. Feedback is a small toast we
// inject onto the page itself (top-right), with Undo. When a save completes a
// batch of five, the toast also tells you the reading block was booked.
// ---------------------------------------------------------------------------

import {
  getItems,
  getSettings,
  addItem,
  markBatched,
  clearBatched,
  deleteItem,
  addReview,
  removeReview,
} from "./lib/storage.js";
import { nextBatch } from "./lib/batch.js";
import { scheduleReadingBlock, deleteReadingEvent } from "./lib/calendar.js";

const DASHBOARD = "src/options.html";
const REVIEW_ALARM_PREFIX = "review:";

// --- Right-click menu on the toolbar icon -----------------------------------
// Context menus are registered once, when the extension installs or updates.
chrome.runtime.onInstalled.addListener(() => {
  // Clear first so reloading the extension never errors on duplicate ids.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-list",
      title: "Reading list",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "open-settings",
      title: "Settings",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  // Both items open the same dashboard tab; the hash tells it where to scroll.
  const hash = info.menuItemId === "open-settings" ? "#settings" : "#reading-list";
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD) + hash });
});

// --- When a reading block ends: pop up the review checklist ------------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(REVIEW_ALARM_PREFIX)) return;
  const reviewId = alarm.name.slice(REVIEW_ALARM_PREFIX.length);
  // Open a small popup window with the "what did you finish?" checklist.
  chrome.windows.create({
    url: chrome.runtime.getURL(`src/review.html?rid=${encodeURIComponent(reviewId)}`),
    type: "popup",
    width: 440,
    height: 600,
  });
});

// --- Left-click on the icon: save the current page --------------------------
chrome.action.onClicked.addListener((tab) => {
  saveCurrentTab(tab).catch((err) => console.error("Reading Block:", err));
});

async function saveCurrentTab(tab) {
  const url = tab?.url || "";
  // Only normal web pages can be saved (not chrome:// pages, the dashboard, the
  // new-tab page, etc.). On those there's nothing to do and we can't inject our
  // confirmation either, so we quietly do nothing.
  if (!/^https?:/i.test(url)) return;

  const result = await saveAndMaybeSchedule(url, tab.title);
  if (tab.id == null) return;

  // Confirm right on the page. If this save booked a reading block, the toast
  // says so (and Undo reverses the whole booking); otherwise it's a plain save.
  if (result.scheduled) {
    showInPageToast(tab.id, {
      mode: "booked",
      when: result.scheduled.whenText,
      savedId: result.item.id,
      eventId: result.scheduled.eventId,
      batchIds: result.scheduled.batchIds,
    });
  } else if (result.scheduleError) {
    // The page was saved, but booking the block failed (e.g. no free slot). Say
    // so right in the toast instead of via a system notification.
    showInPageToast(tab.id, {
      mode: "saved",
      savedId: result.item.id,
      note: "Couldn't book a block yet.",
    });
  } else {
    showInPageToast(tab.id, { mode: "saved", savedId: result.item.id });
  }
}

// --- Undo (from the in-page toast) ------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "UNDO_SAVE") {
    deleteItem(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "UNDO_BOOKING") {
    undoBooking(message)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// Reverse a booking completely: delete the calendar event, put those reads back
// to "waiting", and remove the page that was just saved.
async function undoBooking({ savedId, eventId, batchIds }) {
  const settings = await getSettings();
  if (eventId) {
    try {
      await deleteReadingEvent(eventId, settings);
    } catch (_) {
      /* event may already be gone; carry on cleaning up locally */
    }
    // Cancel the pending after-block review for this booking too.
    chrome.alarms.clear(REVIEW_ALARM_PREFIX + eventId);
    await removeReview(eventId);
  }
  if (Array.isArray(batchIds) && batchIds.length) await clearBatched(batchIds);
  if (savedId) await deleteItem(savedId);
}

// Inject the confirmation toast into the page the user just saved.
async function showInPageToast(tabId, opts) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: deepreadToast,
      args: [opts],
    });
  } catch (_) {
    // Some pages forbid injection (e.g. the Chrome Web Store). Saving still
    // worked; we just couldn't show the in-page confirmation.
  }
}

// This function is serialized and run INSIDE the saved page. It must be fully
// self-contained (no outside variables) and uses inline styles inside a shadow
// root so the host page's CSS can't touch it and its CSS can't touch the page.
// `opts` is { mode:'saved'|'booked', savedId, note?, when?, eventId?, batchIds? }.
function deepreadToast(opts) {
  const HOST_ID = "__readingblock_toast__";
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();

  const booked = opts.mode === "booked";

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Top-right corner, just under the toolbar, so Undo is right below the icon
  // you just clicked (minimal mouse travel).
  host.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });

  const box = document.createElement("div");
  box.style.cssText =
    "display:flex;align-items:center;gap:11px;padding:11px 13px 11px 15px;" +
    "border-radius:12px;background:#f7f1e4;color:#241d13;border:1px solid #d8cbae;" +
    "box-shadow:0 12px 32px -12px rgba(40,30,12,.5);" +
    "font-family:'Avenir Next',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "font-size:14px;line-height:1.3;opacity:0;transform:translateY(-10px);" +
    "transition:opacity .22s ease,transform .22s ease;";

  const dot = document.createElement("span");
  dot.style.cssText =
    "width:8px;height:8px;border-radius:50%;background:#1c6b54;flex:0 0 auto;margin-top:2px;align-self:flex-start;";

  const text = document.createElement("div");
  if (booked) {
    const line1 = document.createElement("div");
    line1.textContent = "Reading block booked";
    line1.style.cssText = "font-weight:700;";
    const line2 = document.createElement("div");
    line2.textContent = opts.when || "";
    line2.style.cssText = "color:#6d6049;margin-top:2px;";
    text.append(line1, line2);
  } else {
    const line1 = document.createElement("div");
    line1.textContent = "Saved to Reading Block";
    line1.style.cssText = "font-weight:500;";
    text.append(line1);
    if (opts.note) {
      const line2 = document.createElement("div");
      line2.textContent = opts.note;
      line2.style.cssText = "color:#6d6049;margin-top:2px;font-size:13px;";
      text.append(line2);
    }
  }

  const undo = document.createElement("button");
  undo.textContent = "Undo";
  undo.style.cssText =
    "background:none;border:none;color:#1c6b54;font-weight:700;font-family:inherit;" +
    "font-size:14px;cursor:pointer;padding:4px 6px;border-radius:6px;margin-left:2px;align-self:center;";
  undo.addEventListener("mouseenter", () => (undo.style.background = "rgba(28,107,84,.10)"));
  undo.addEventListener("mouseleave", () => (undo.style.background = "none"));

  box.append(dot, text, undo);
  shadow.append(box);
  document.body.appendChild(host);

  requestAnimationFrame(() => {
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";
  });

  // Booked confirmations carry more to read, so they linger a little longer.
  let timer = setTimeout(close, booked ? 5000 : 3000);
  function close() {
    box.style.opacity = "0";
    box.style.transform = "translateY(-10px)";
    setTimeout(() => host.remove(), 260);
  }

  undo.addEventListener("click", () => {
    clearTimeout(timer);
    try {
      if (booked) {
        chrome.runtime.sendMessage({
          type: "UNDO_BOOKING",
          savedId: opts.savedId,
          eventId: opts.eventId,
          batchIds: opts.batchIds,
        });
      } else {
        chrome.runtime.sendMessage({ type: "UNDO_SAVE", id: opts.savedId });
      }
    } catch (_) {}
    text.replaceChildren(document.createTextNode(booked ? "Booking undone" : "Removed"));
    undo.remove();
    timer = setTimeout(close, 1300);
  });
}

// The core flow: save the page, and if that completes a batch of five, find a
// free slot (on a day that doesn't already have one) and book the reading block.
async function saveAndMaybeSchedule(url, title) {
  const item = await addItem({ url, title });
  const [items, settings] = await Promise.all([getItems(), getSettings()]);

  const { ready, batch } = nextBatch(items, settings.batchSize);
  if (!ready) {
    return { item, scheduled: null };
  }

  const batchIds = batch.map((b) => b.id);
  try {
    const { slot, event } = await scheduleReadingBlock(batch, settings);
    await markBatched(batchIds, slot.start.toISOString());

    // Schedule the after-block review: remember the items, and set a timer for
    // the block's end so we can ask what got finished.
    const reviewId = event?.id || `r${slot.start.getTime()}`;
    await addReview({ id: reviewId, itemIds: batchIds, endsAt: slot.end.getTime() });
    chrome.alarms.create(REVIEW_ALARM_PREFIX + reviewId, { when: slot.end.getTime() });

    return {
      item,
      scheduled: {
        whenText: formatWhen(slot.start),
        count: batch.length,
        eventId: event?.id || null,
        batchIds,
      },
    };
  } catch (err) {
    return { item, scheduled: null, scheduleError: err.message };
  }
}

// --- Small helpers ----------------------------------------------------------

// Friendly date like "Mon, Jun 29 at 2:00 PM" in the machine's local time.
function formatWhen(date) {
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

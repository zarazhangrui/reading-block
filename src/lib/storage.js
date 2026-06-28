// storage.js
// ---------------------------------------------------------------------------
// The only file that talks to Chrome's local storage box. Think of it as the
// filing cabinet: every other brick asks IT to read or write, and never reaches
// into chrome.storage directly. That keeps the storage details in one place, so
// if we ever swap to a Google Sheet or a database, only this file changes.
// ---------------------------------------------------------------------------

// The keys under which we file our two kinds of data.
const ITEMS_KEY = "items"; // the reading list
const SETTINGS_KEY = "settings"; // the user's preferences

// Sensible starting preferences (weekday afternoons, 30 min).
export const DEFAULT_SETTINGS = {
  days: [1, 2, 3, 4, 5], // Mon–Fri (0=Sun … 6=Sat)
  windowStart: "14:00",
  windowEnd: "18:00",
  blockMinutes: 30,
  batchSize: 5,
  lookaheadDays: 14, // search up to two weeks ahead for a free slot
  calendarId: "primary", // change to a TEST calendar id while testing
  eventTitle: "Reading Block",
};

// --- Reading list -----------------------------------------------------------

export async function getItems() {
  const data = await chrome.storage.local.get(ITEMS_KEY);
  return data[ITEMS_KEY] || [];
}

export async function setItems(items) {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

// Add a brand-new saved page to the front of the list. Returns the new item.
export async function addItem({ url, title }) {
  const items = await getItems();

  // Guard against saving the exact same URL twice in a row while it's still
  // unread — saves you from accidental double-clicks padding your batch.
  const alreadyWaiting = items.find((it) => it.url === url && !it.read && !it.batchedAt);
  if (alreadyWaiting) return alreadyWaiting;

  const item = {
    id: cryptoRandomId(),
    url,
    title: title || url, // fall back to the URL if a page has no title
    savedAt: new Date().toISOString(),
    read: false,
    batchedAt: null, // set once this item has been placed into a calendar block
  };
  await setItems([item, ...items]);
  return item;
}

// Flip an item's read/unread state, or delete it. These return the updated list
// so the popup can re-render immediately.
export async function setRead(id, read) {
  const items = (await getItems()).map((it) => (it.id === id ? { ...it, read } : it));
  await setItems(items);
  return items;
}

export async function deleteItem(id) {
  const items = (await getItems()).filter((it) => it.id !== id);
  await setItems(items);
  return items;
}

// Mark a group of items (a batch) as scheduled, so they won't be batched again.
export async function markBatched(ids, batchedAt) {
  const stamp = batchedAt || new Date().toISOString();
  const idSet = new Set(ids);
  const items = (await getItems()).map((it) =>
    idSet.has(it.id) ? { ...it, batchedAt: stamp } : it
  );
  await setItems(items);
  return items;
}

// The reverse of markBatched: put items back to "waiting" (used when the user
// undoes a booking, so those reads can be scheduled again next time).
export async function clearBatched(ids) {
  const idSet = new Set(ids);
  const items = (await getItems()).map((it) =>
    idSet.has(it.id) ? { ...it, batchedAt: null } : it
  );
  await setItems(items);
  return items;
}

// --- Reviews ----------------------------------------------------------------
// A "review" is the little after-the-block checklist. When we book a block we
// remember which items it held and when it ends, so that when the timer fires
// we can ask "which of these did you finish?".

const REVIEWS_KEY = "reviews";

export async function getReviews() {
  const data = await chrome.storage.local.get(REVIEWS_KEY);
  return data[REVIEWS_KEY] || [];
}

export async function addReview(review) {
  const reviews = await getReviews();
  await chrome.storage.local.set({ [REVIEWS_KEY]: [...reviews, review] });
}

export async function getReview(id) {
  return (await getReviews()).find((r) => r.id === id) || null;
}

export async function removeReview(id) {
  const reviews = (await getReviews()).filter((r) => r.id !== id);
  await chrome.storage.local.set({ [REVIEWS_KEY]: reviews });
}

// --- Settings ---------------------------------------------------------------

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  // Merge saved settings over the defaults, so new default keys appear even for
  // users who saved settings before those keys existed.
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// --- Helpers ----------------------------------------------------------------

// A short, collision-proof id. crypto.randomUUID exists in extension contexts.
function cryptoRandomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Extremely unlikely fallback, here only so the file never throws.
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

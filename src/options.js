// options.js — the full-page dashboard. Two jobs: manage the reading list, and
// edit settings. It talks to the storage brick directly (no background worker
// needed for reads/edits here).

import {
  getItems,
  setRead,
  deleteItem,
  getSettings,
  setSettings,
  DEFAULT_SETTINGS,
} from "./lib/storage.js";

// ===========================================================================
// READING LIST
// ===========================================================================

// A small inline SVG icon as an element.
function svg(paths, width = "1.8") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", width);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    el.appendChild(p);
  }
  return el;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function savedAgo(iso) {
  const then = new Date(iso);
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function renderList() {
  const list = document.getElementById("list");
  const items = await getItems();
  list.replaceChildren();

  const count = document.getElementById("list-count");
  const unread = items.filter((it) => !it.read).length;
  count.textContent = items.length
    ? `${items.length} saved · ${unread} unread`
    : "";

  if (items.length === 0) {
    list.appendChild(emptyState());
    return;
  }

  items.forEach((item, i) => list.appendChild(renderItem(item, i)));
}

function emptyState() {
  const li = document.createElement("li");
  li.className = "empty";
  const ornament = document.createElement("div");
  ornament.className = "ornament";
  ornament.appendChild(
    svg(["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"], "1.4")
  );
  const h = document.createElement("p");
  h.className = "display";
  h.textContent = "Nothing saved yet";
  const p = document.createElement("p");
  p.textContent = "Click the Reading Block icon in your toolbar on any article to save it here.";
  li.append(ornament, h, p);
  return li;
}

function renderItem(item, index) {
  const li = document.createElement("li");
  li.className = "item" + (item.read ? " read" : "");
  li.style.animationDelay = `${Math.min(index, 10) * 25}ms`;

  // Round read/unread checkbox.
  const check = document.createElement("button");
  check.className = "check";
  check.title = item.read ? "Mark as unread" : "Mark as read";
  check.appendChild(svg(["M20 6L9 17l-5-5"], "2.4"));
  check.addEventListener("click", async () => {
    await setRead(item.id, !item.read);
    renderList();
  });

  // Title + meta. Clicking the title opens the article in a new tab.
  const body = document.createElement("div");
  body.className = "item-body";

  const title = document.createElement("a");
  title.className = "item-title";
  title.textContent = item.title;
  title.href = item.url;
  title.target = "_blank";
  title.rel = "noreferrer";

  const meta = document.createElement("div");
  meta.className = "item-meta";
  const metaText = `${domainOf(item.url)} · saved ${savedAgo(item.savedAt)}`;
  meta.append(document.createTextNode(metaText));
  // A subtle tag for items already placed into a calendar block.
  if (item.batchedAt) {
    const tag = document.createElement("span");
    tag.className = "tag scheduled";
    tag.textContent = "Scheduled";
    meta.append(tag);
  }

  body.append(title, meta);

  // Delete button.
  const del = document.createElement("button");
  del.className = "del";
  del.title = "Remove";
  del.appendChild(svg(["M18 6L6 18", "M6 6l12 12"], "2"));
  del.addEventListener("click", async () => {
    await deleteItem(item.id);
    renderList();
  });

  li.append(check, body, del);
  return li;
}

// ===========================================================================
// SETTINGS
// ===========================================================================

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let selectedDays = new Set();

function buildDays(active) {
  selectedDays = new Set(active);
  const wrap = document.getElementById("days");
  wrap.replaceChildren();
  DAY_LABELS.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day" + (selectedDays.has(i) ? " on" : "");
    btn.textContent = label;
    btn.title = DAY_NAMES[i];
    btn.addEventListener("click", () => {
      if (selectedDays.has(i)) {
        selectedDays.delete(i);
        btn.classList.remove("on");
      } else {
        selectedDays.add(i);
        btn.classList.add("on");
      }
    });
    wrap.appendChild(btn);
  });
}

function fillSettings(settings) {
  buildDays(settings.days);
  document.getElementById("windowStart").value = settings.windowStart;
  document.getElementById("windowEnd").value = settings.windowEnd;
  document.getElementById("blockMinutes").value = settings.blockMinutes;
  document.getElementById("batchSize").value = settings.batchSize;
  document.getElementById("lookaheadDays").value = settings.lookaheadDays;
  document.getElementById("eventTitle").value = settings.eventTitle;
  document.getElementById("calendarId").value = settings.calendarId;
}

function collectSettings() {
  const num = (id, min, max, fallback) => {
    const v = parseInt(document.getElementById(id).value, 10);
    if (Number.isNaN(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };
  return {
    days: [...selectedDays].sort((a, b) => a - b),
    windowStart: document.getElementById("windowStart").value || DEFAULT_SETTINGS.windowStart,
    windowEnd: document.getElementById("windowEnd").value || DEFAULT_SETTINGS.windowEnd,
    blockMinutes: num("blockMinutes", 5, 240, DEFAULT_SETTINGS.blockMinutes),
    batchSize: num("batchSize", 1, 20, DEFAULT_SETTINGS.batchSize),
    lookaheadDays: num("lookaheadDays", 1, 60, DEFAULT_SETTINGS.lookaheadDays),
    eventTitle: document.getElementById("eventTitle").value.trim() || DEFAULT_SETTINGS.eventTitle,
    calendarId: document.getElementById("calendarId").value.trim() || DEFAULT_SETTINGS.calendarId,
  };
}

function flashSaved() {
  const note = document.getElementById("saved-note");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 1800);
}

// ===========================================================================
// STARTUP
// ===========================================================================

async function init() {
  await renderList();
  fillSettings(await getSettings());

  document.getElementById("save").addEventListener("click", async () => {
    const next = collectSettings();
    await setSettings(next);
    fillSettings(next);
    flashSaved();
  });

  // The right-click menu opens this page with #reading-list or #settings so the
  // browser jumps to the relevant section. We nudge the scroll to be sure.
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
  }

  // Keep the list fresh if a save happens (from the toolbar icon) while this
  // tab is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.items) renderList();
  });
}

init();

// review.js — the little checklist that pops up when a reading block ends.
// For each item in the block, you tick "finished" or leave it for next time.

import { getReview, getItems, setItems, removeReview } from "./lib/storage.js";

// Which review are we showing? The window was opened with ?rid=<id>.
const rid = new URLSearchParams(location.search).get("rid");

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function init() {
  const review = await getReview(rid);
  const allItems = await getItems();
  // The block's items that still exist (some may have been deleted since).
  const items = review ? allItems.filter((it) => review.itemIds.includes(it.id)) : [];

  const listEl = document.getElementById("review-list");
  const doneBtn = document.getElementById("done");

  // Nothing left to review (deleted, or already cleaned up): just offer to close.
  if (items.length === 0) {
    document.getElementById("intro").textContent = "Nothing to review here.";
    doneBtn.textContent = "Close";
    doneBtn.addEventListener("click", async () => {
      if (rid) await removeReview(rid);
      window.close();
    });
    return;
  }

  // Build a checkbox row per item. Default checked = whatever its read state is,
  // so anything you already marked read shows as finished.
  const boxes = new Map();
  items.forEach((it) => {
    const li = document.createElement("li");
    li.className = "review-row";

    const label = document.createElement("label");
    label.className = "review-rowlabel";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!it.read;
    boxes.set(it.id, cb);

    const body = document.createElement("span");
    body.className = "review-body";
    const title = document.createElement("span");
    title.className = "review-itemtitle";
    title.textContent = it.title;
    const meta = document.createElement("span");
    meta.className = "review-itemmeta";
    meta.textContent = domainOf(it.url);
    body.append(title, meta);

    label.append(cb, body);
    li.append(label);
    listEl.append(li);
  });

  doneBtn.addEventListener("click", async () => {
    // Apply every change in a single write.
    const updated = allItems.map((it) => {
      const cb = boxes.get(it.id);
      if (!cb) return it; // not part of this block
      if (cb.checked) {
        // Finished: mark read (stays out of future blocks).
        return { ...it, read: true };
      }
      // Not finished: back to waiting (unread + un-batched) so it can be
      // scheduled into a future block.
      return { ...it, read: false, batchedAt: null };
    });
    await setItems(updated);
    if (rid) await removeReview(rid);
    window.close();
  });
}

init();

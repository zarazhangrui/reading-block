// batch.js
// ---------------------------------------------------------------------------
// The rule-keeper for "every 5 saves makes a reading block." Pure logic, no
// Chrome, no Google — just answers questions about a list of saved items.
//
// An item is "eligible" for a batch when it is BOTH unread AND not already part
// of a previous batch (batchedAt is null). Reading something, or having it
// already scheduled, takes it out of the running for future blocks.
// ---------------------------------------------------------------------------

/**
 * Which saved items are still waiting to be put into a reading block?
 * @param {Array} items  Saved items: { id, read, batchedAt, savedAt, ... }
 * @returns {Array} the eligible items, oldest first.
 */
export function eligibleItems(items) {
  return items
    .filter((it) => !it.read && !it.batchedAt)
    .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
}

/**
 * Is a full batch ready, and if so which items belong to it?
 * @param {Array} items
 * @param {number} batchSize  e.g. 5
 * @returns {{ready: boolean, batch: Array}}  When ready, `batch` is exactly the
 *          oldest `batchSize` eligible items. We take the OLDEST so the things
 *          you saved first get read first (FIFO), and we take exactly one batch
 *          at a time even if you somehow have 10+ waiting.
 */
export function nextBatch(items, batchSize) {
  const eligible = eligibleItems(items);
  if (eligible.length >= batchSize) {
    return { ready: true, batch: eligible.slice(0, batchSize) };
  }
  return { ready: false, batch: [] };
}

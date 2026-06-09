// Ventana deslizante en memoria. Suficiente para un evento single-instance.
const buckets = new Map();

function prune(timestamps, now, windowMs) {
  const cutoff = now - windowMs;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}

/**
 * @returns {null | { retryAfterSec: number }}
 */
export function checkAndRecord(key, limits) {
  const now = Date.now();
  const entry = buckets.get(key) ?? { short: [], long: [] };

  prune(entry.short, now, limits.shortMs);
  prune(entry.long, now, limits.longMs);

  if (entry.short.length >= limits.shortMax) {
    const retry = Math.ceil((limits.shortMs - (now - entry.short[0])) / 1000);
    return { retryAfterSec: Math.max(1, retry) };
  }
  if (entry.long.length >= limits.longMax) {
    const retry = Math.ceil((limits.longMs - (now - entry.long[0])) / 1000);
    return { retryAfterSec: Math.max(1, retry) };
  }

  entry.short.push(now);
  entry.long.push(now);
  buckets.set(key, entry);
  return null;
}

export const DELETE_LIMITS = {
  shortMax: 5,
  shortMs: 60 * 1000,
  longMax: 30,
  longMs: 60 * 60 * 1000,
};

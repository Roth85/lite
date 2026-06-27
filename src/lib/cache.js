// Tiny in-memory TTL cache. Keeps Drive/Toast pulls from hitting the wire on
// every chat turn. Process-local — fine for a single always-on relay; swap for
// Redis if you ever run multiple instances.

const store = new Map(); // key -> { value, expiresAt }

const DEFAULT_TTL_MS =
  (Number(process.env.CONTEXT_CACHE_TTL_SECONDS) || 900) * 1000;

/**
 * Get a cached value or compute it via `producer` and cache the result.
 * @param {string} key
 * @param {() => Promise<T>} producer
 * @param {number} [ttlMs]
 * @returns {Promise<T>}
 * @template T
 */
export async function cached(key, producer, ttlMs = DEFAULT_TTL_MS) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await producer();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(key) {
  if (key === undefined) store.clear();
  else store.delete(key);
}

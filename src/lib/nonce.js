// LRU nonce store with TTL — defends against replay.
// In-memory only; lost on service-worker restart (acceptable for 7a).

const MIN_LEN = 8;
const MAX_LEN = 128;

export function createNonceStore({ capacity = 256, ttlMs = 5 * 60_000 } = {}) {
  // Map preserves insertion order — leveraged for LRU eviction.
  const store = new Map();

  function evictExpired(now) {
    for (const [nonce, ts] of store) {
      if (now - ts > ttlMs) {
        store.delete(nonce);
      } else {
        // Insertion order means once we hit a non-expired entry,
        // every entry after it is also non-expired.
        break;
      }
    }
  }

  function tryConsume(nonce) {
    if (typeof nonce !== "string") return false;
    if (nonce.length < MIN_LEN || nonce.length > MAX_LEN) return false;

    const now = Date.now();
    evictExpired(now);

    if (store.has(nonce)) return false;

    store.set(nonce, now);
    while (store.size > capacity) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
    return true;
  }

  return { tryConsume };
}

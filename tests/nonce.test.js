import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNonceStore } from "../src/lib/nonce.js";

describe("createNonceStore", () => {
  it("returns true on first sight and false on replay", () => {
    const store = createNonceStore();
    expect(store.tryConsume("abcdefgh")).toBe(true);
    expect(store.tryConsume("abcdefgh")).toBe(false);
  });

  it("rejects non-string, empty, too-short, and too-long nonces", () => {
    const store = createNonceStore();
    expect(store.tryConsume(undefined)).toBe(false);
    expect(store.tryConsume(null)).toBe(false);
    expect(store.tryConsume(12345)).toBe(false);
    expect(store.tryConsume("")).toBe(false);
    expect(store.tryConsume("short")).toBe(false); // 5 chars
    expect(store.tryConsume("a".repeat(129))).toBe(false);
  });

  it("evicts oldest entry after capacity is exceeded (LRU)", () => {
    const store = createNonceStore({ capacity: 3, ttlMs: 60_000 });
    expect(store.tryConsume("nonce-001")).toBe(true);
    expect(store.tryConsume("nonce-002")).toBe(true);
    expect(store.tryConsume("nonce-003")).toBe(true);
    // Within capacity — replays must still be rejected.
    expect(store.tryConsume("nonce-001")).toBe(false);
    // 4th distinct nonce — evicts the oldest (nonce-001).
    expect(store.tryConsume("nonce-004")).toBe(true);
    // nonce-001 is now evicted, so it should be accepted again.
    expect(store.tryConsume("nonce-001")).toBe(true);
  });

  describe("TTL expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows reuse after ttlMs has elapsed", () => {
      const ttlMs = 1000;
      const store = createNonceStore({ capacity: 10, ttlMs });
      vi.setSystemTime(new Date(0));
      expect(store.tryConsume("nonce-ttl")).toBe(true);
      expect(store.tryConsume("nonce-ttl")).toBe(false);
      vi.setSystemTime(new Date(ttlMs + 1));
      expect(store.tryConsume("nonce-ttl")).toBe(true);
    });
  });
});

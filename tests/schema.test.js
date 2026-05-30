import { describe, it, expect } from "vitest";
import { validatePayload } from "../src/lib/schema.js";

function minimalPayload(overrides = {}) {
  return {
    title: "안녕 모먼틀리",
    metaDescription: "테스트 설명",
    hashtags: ["momently", "test"],
    blocks: [{ kind: "text", markdown: "본문" }],
    imageUrls: [],
    ...overrides,
  };
}

describe("validatePayload", () => {
  it("accepts a minimal text-only payload", () => {
    const result = validatePayload(minimalPayload());
    expect(result.ok).toBe(true);
    expect(result.sanitized.title).toBe("안녕 모먼틀리");
  });

  it("rejects missing required field with MISSING_FIELD", () => {
    const p = minimalPayload();
    delete p.metaDescription;
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "MISSING_FIELD" });
  });

  it("rejects title over 200 chars with OVER_LIMIT", () => {
    const p = minimalPayload({ title: "a".repeat(201) });
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "OVER_LIMIT" });
  });

  it("rejects control characters in title with CONTROL_CHARS", () => {
    const p = minimalPayload({ title: "bad\x01title" });
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "CONTROL_CHARS" });
  });

  it("rejects unknown block kind with BAD_BLOCK_KIND", () => {
    const p = minimalPayload({ blocks: [{ kind: "video", url: "https://x" }] });
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "BAD_BLOCK_KIND" });
  });

  it("rejects \\r (carriage return) as a control char", () => {
    const p = minimalPayload({ title: "bad\rtitle" });
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "CONTROL_CHARS" });
  });

  it("does not propagate __proto__ keys into sanitized payload", () => {
    const raw = JSON.parse(
      '{"title":"ok","metaDescription":"ok","hashtags":[],"blocks":[{"kind":"text","markdown":"x"}],"imageUrls":[],"__proto__":{"polluted":true}}'
    );
    const result = validatePayload(raw);
    expect(result.ok).toBe(true);
    expect(result.sanitized.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it("rejects payload exceeding 1MB with OVERSIZED", () => {
    // 60_000 char markdown × 20 blocks ≈ 1.2 MB. Block count stays within limit (<=200).
    const big = "x".repeat(60_000);
    const blocks = Array.from({ length: 20 }, () => ({ kind: "text", markdown: big }));
    // Each block is under TEXT_MD_MAX (50_000) — bump above? No, we need to trigger
    // OVERSIZED first. Use blocks within TEXT_MD_MAX but inflate count.
    // 49_000 × 25 ≈ 1_225_000 bytes; 25 blocks is under BLOCK_MAX_COUNT (200).
    const md = "x".repeat(49_000);
    const heavyBlocks = Array.from({ length: 25 }, () => ({ kind: "text", markdown: md }));
    const p = minimalPayload({ blocks: heavyBlocks });
    const result = validatePayload(p);
    expect(result).toEqual({ ok: false, reason: "OVERSIZED" });
    // Silence unused warning.
    void blocks;
  });
});

import { describe, it, expect } from "vitest";
import { isImageUrlAllowed, filterImageUrls } from "../src/lib/ssrf.js";

describe("isImageUrlAllowed", () => {
  it("accepts a valid public HTTPS URL", () => {
    expect(isImageUrlAllowed("https://cdn.example.com/img/x.jpg")).toBe(true);
  });

  it("rejects http scheme", () => {
    expect(isImageUrlAllowed("http://example.com/x.jpg")).toBe(false);
  });

  it("rejects loopback / private / link-local / IMDS hosts", () => {
    const cases = [
      "https://localhost/x.jpg",
      "https://127.0.0.1/x.jpg",
      "https://0.0.0.0/x.jpg",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/x.jpg",
      "https://172.16.5.5/x.jpg",
      "https://192.168.1.1/x.jpg",
      "https://[::1]/x.jpg",
      "https://foo.local/x.jpg",
    ];
    for (const url of cases) {
      expect(isImageUrlAllowed(url), `expected reject: ${url}`).toBe(false);
    }
  });

  it("rejects non-https schemes (file/chrome-extension/data)", () => {
    expect(isImageUrlAllowed("file:///etc/passwd")).toBe(false);
    expect(isImageUrlAllowed("chrome-extension://abc/x.jpg")).toBe(false);
    expect(isImageUrlAllowed("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("filterImageUrls", () => {
  it("short-circuits on first violation with badUrl", () => {
    const result = filterImageUrls([
      "https://ok.example.com/x.jpg",
      "http://bad/x",
    ]);
    expect(result).toEqual({ ok: false, badUrl: "http://bad/x" });
  });

  it("passes when all URLs are allowed", () => {
    const result = filterImageUrls([
      "https://ok.example.com/x.jpg",
      "https://cdn.example.org/y.png",
    ]);
    expect(result).toEqual({ ok: true });
  });
});

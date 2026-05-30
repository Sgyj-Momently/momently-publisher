// content/console-bridge.js — runs in the console origin only.
// Manifest V3 content scripts cannot use ES module imports directly, so this
// file is intentionally dependency-free; all lib-based validation happens in
// the background service worker.
//
// 7a: echo-only. Receives postMessage envelopes from the console page, applies
// the three outer defenses (origin allowlist, source check, envelope shape),
// then forwards to the background. Logs the background's reply. NO DOM
// injection of any kind in 7a.

(() => {
  const CONSOLE_ORIGIN_ALLOWLIST = new Set([
    "https://momently.tpsg.co.kr",
    "http://127.0.0.1:18580",
  ]);
  const EXPECTED_TYPE = "momently/publish-request";

  function isValidEnvelope(data) {
    if (data === null || typeof data !== "object") return false;
    if (data.type !== EXPECTED_TYPE) return false;
    if (typeof data.nonce !== "string" || data.nonce.length === 0) return false;
    if (data.payload === null || typeof data.payload !== "object" || Array.isArray(data.payload)) {
      return false;
    }
    return true;
  }

  window.addEventListener("message", (event) => {
    // 1) origin allowlist — silent reject otherwise.
    if (!CONSOLE_ORIGIN_ALLOWLIST.has(event.origin)) return;
    // 2) source/window check — defends against iframe spoofing.
    if (event.source !== window) return;
    // 3) envelope shape.
    if (!isValidEnvelope(event.data)) return;

    const { nonce, payload } = event.data;

    try {
      chrome.runtime.sendMessage(
        { type: EXPECTED_TYPE, nonce, payload },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[momently-publisher] bridge sendMessage error", chrome.runtime.lastError.message);
            return;
          }
          // Reply back to the page using the same origin we received from.
          window.postMessage(
            { type: "momently/publish-response", nonce, response },
            event.origin
          );
        }
      );
    } catch (err) {
      console.warn("[momently-publisher] bridge dispatch failed", err);
    }
  });
})();

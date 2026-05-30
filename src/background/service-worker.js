// background/service-worker.js — Manifest V3 ES module service worker.
// 7a: echo-only. Applies nonce + schema + SSRF defenses on each forwarded
// envelope. NO Naver/DOM interaction.

import { createNonceStore } from "../lib/nonce.js";
import { validatePayload } from "../lib/schema.js";
import { filterImageUrls } from "../lib/ssrf.js";

const EXPECTED_TYPE = "momently/publish-request";
const nonceStore = createNonceStore();

function reject(reason) {
  console.log(`[momently-publisher] reject reason=${reason}`);
  return { ok: false, reason };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message === null || typeof message !== "object") {
    sendResponse(reject("BAD_TYPE"));
    return false;
  }
  if (message.type !== EXPECTED_TYPE) {
    sendResponse(reject("BAD_TYPE"));
    return false;
  }

  const { nonce, payload } = message;

  if (!nonceStore.tryConsume(nonce)) {
    sendResponse(reject("NONCE_REPLAY"));
    return false;
  }

  const schemaResult = validatePayload(payload);
  if (!schemaResult.ok) {
    sendResponse(reject(schemaResult.reason));
    return false;
  }

  const ssrfResult = filterImageUrls(schemaResult.sanitized.imageUrls);
  if (!ssrfResult.ok) {
    sendResponse(reject("SSRF_BLOCKED"));
    return false;
  }

  const blockCount = Array.isArray(schemaResult.sanitized.blocks)
    ? schemaResult.sanitized.blocks.length
    : 0;
  console.log(`[momently-publisher] echo accepted nonce=${nonce} blocks=${blockCount}`);
  sendResponse({ ok: true });
  return false;
});

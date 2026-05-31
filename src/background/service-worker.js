// background/service-worker.js — Manifest V3 ES module service worker.
//
// 7a: 콘솔 브리지에서 온 envelope 에 nonce + schema + SSRF 방어를 적용.
// 7b: 검증 통과 후 echo 만 하던 것을, blog.naver.com content script 로
//     검증된 payload 를 RELAY 한다(port 기반). Naver 탭/포트가 없으면 구조화된
//     { ok:false, reason:'NO_NAVER_TARGET' } 를 반환한다(graceful).
//
// port 기반 relay 라 background 가 탭을 직접 조회하지 않으므로 'tabs' 권한이
// 필요 없다(host_permissions 도 content_scripts 매처로 충분). NO DOM interaction
// in background.

import { createNonceStore } from "../lib/nonce.js";
import { validatePayload } from "../lib/schema.js";
import { filterImageUrls } from "../lib/ssrf.js";

const EXPECTED_TYPE = "momently/publish-request";
const RELAY_PORT_NAME = "momently/naver-relay";
const PUBLISH_MESSAGE_TYPE = "momently/publish-to-naver";

const nonceStore = createNonceStore();

// blog.naver.com content script 들이 connect 로 붙는 port 집합.
// content script 가 살아있는 동안만 유지된다(탭 닫힘/이동 시 onDisconnect 로 제거).
const naverPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RELAY_PORT_NAME) return;
  naverPorts.add(port);
  port.onDisconnect.addListener(() => {
    naverPorts.delete(port);
  });
});

function reject(reason) {
  console.log(`[momently-publisher] reject reason=${reason}`);
  return { ok: false, reason };
}

// 검증된 payload 를 연결된 Naver content script 로 relay 한다.
// content script 의 inject 결과({ ok, injected } 또는 { ok:false, reason })를
// 그대로 콘솔로 돌려준다. 연결된 port 가 없으면 NO_NAVER_TARGET.
function relayToNaver(sanitized) {
  // 가장 최근에 붙은 port 를 대상으로 한다(여러 글쓰기 탭은 드묾).
  let target = null;
  for (const port of naverPorts) target = port;
  if (!target) {
    return Promise.resolve(reject("NO_NAVER_TARGET"));
  }

  const title = sanitized.title;
  // 7b: 본문은 text 블록의 markdown 을 평문으로 이어붙인 것을 사용한다.
  // 리치 렌더링(서식)은 7d 의 몫. 여기서는 단순 텍스트만 넘긴다.
  const bodyText = Array.isArray(sanitized.blocks)
    ? sanitized.blocks
        .filter((b) => b && b.kind === "text" && typeof b.markdown === "string")
        .map((b) => b.markdown)
        .join("\n\n")
    : "";

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    // 단일 정리 경로: listener 제거 + timer 해제 + 1회만 resolve.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      try {
        target.onMessage.removeListener(onResult);
      } catch {
        // ignore
      }
      resolve(result);
    };
    const onResult = (message) => {
      if (message === null || typeof message !== "object") return;
      if (message.type !== "momently/publish-to-naver-result") return;
      finish(message.result || { ok: false, reason: "NO_RESULT" });
    };

    // content script 가 응답하지 않고 port 만 살아있는 경우(주입 hang 등) 대비.
    // 콘솔측 핸드셰이크 timeout(5s)보다 짧게 두어, hang 시 background 의 listener
    // leak·미해결 sendResponse 채널을 스스로 정리한다.
    timer = setTimeout(() => finish(reject("RELAY_TIMEOUT")), 4000);

    try {
      target.onMessage.addListener(onResult);
      target.postMessage({
        type: PUBLISH_MESSAGE_TYPE,
        payload: { title, bodyText },
      });
    } catch (err) {
      console.warn("[momently-publisher] relay postMessage 실패", err);
      finish(reject("NO_NAVER_TARGET"));
    }
  });
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
  console.log(
    `[momently-publisher] accepted nonce=${nonce} blocks=${blockCount} → relay to Naver`
  );

  // 7b: echo 대신 검증된 payload 를 Naver content script 로 relay.
  relayToNaver(schemaResult.sanitized).then((result) => {
    sendResponse(result);
  });
  // async sendResponse 를 위해 true 반환(채널 유지).
  return true;
});

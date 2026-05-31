// content/naver-bridge.js — runs in the ISOLATED world on blog.naver.com 글쓰기.
//
// ISOLATED world 라 chrome.runtime 은 쓸 수 있지만 page 의 window.SmartEditor 는
// 볼 수 없다. 그래서 두 역할을 잇는 다리(bridge)다:
//   background ──(port: momently/naver-relay)──▶ 이 bridge
//   bridge ──(window.postMessage: momently/se-inject)──▶ MAIN-world 스크립트
//   MAIN-world ──(window.postMessage: momently/se-inject-result)──▶ bridge
//   bridge ──(port)──▶ background
//
// MV3 content script 는 ES module import 불가 → dependency-free.
// all_frames:true 로 #mainFrame 안에서도 실행되며, port 연결은 frame 마다 생기지만
// background 는 가장 최근 port 를 target 으로 쓰므로(기존 relay 설계) editor frame
// 의 bridge 가 실제로 응답하게 된다.
//
// ⚠️ ADR 007 hard constraint: 발행/등록은 절대 자동화하지 않는다. 필드 채우기만.

(() => {
  const RELAY_PORT_NAME = "momently/naver-relay";
  const PUBLISH_MESSAGE_TYPE = "momently/publish-to-naver";
  const RESULT_MESSAGE_TYPE = "momently/publish-to-naver-result";
  const SE_REQUEST_TYPE = "momently/se-inject";
  const SE_RESULT_TYPE = "momently/se-inject-result";

  // MAIN-world 응답 대기 timeout. background relay(4s)·콘솔 핸드셰이크(5s)보다 짧게
  // 두어 hang 시 스스로 정리한다.
  const SE_INJECT_TIMEOUT_MS = 4000;

  // intra-page 요청-응답 상관용 nonce. all_frames+MAIN world 라 page 의 다른
  // 스크립트가 같은 window 를 공유하므로, 가짜 결과 끼워넣기·동시 주입 교차를
  // nonce 매칭으로 거른다.
  function genNonce() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  // MAIN-world 스크립트에 주입을 요청하고 결과를 기다린다.
  function injectViaMainWorld(payload) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const nonce = genNonce();

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        try {
          window.removeEventListener("message", onMessage);
        } catch {
          // ignore
        }
        resolve(result);
      };

      const onMessage = (event) => {
        // intra-page MAIN↔ISOLATED: 같은 window/origin 만 신뢰.
        if (event.source !== window) return;
        if (event.origin !== location.origin) return;
        const data = event.data;
        if (data === null || typeof data !== "object") return;
        if (data.type !== SE_RESULT_TYPE) return;
        if (data.nonce !== nonce) return;
        finish(data.result || { ok: false, reason: "NO_RESULT" });
      };

      timer = setTimeout(() => finish({ ok: false, reason: "SE_INJECT_TIMEOUT" }), SE_INJECT_TIMEOUT_MS);

      try {
        window.addEventListener("message", onMessage);
        window.postMessage(
          { type: SE_REQUEST_TYPE, nonce, payload: { title: payload.title, bodyText: payload.bodyText } },
          location.origin
        );
      } catch (err) {
        finish({ ok: false, reason: "SE_INJECT_DISPATCH_FAILED", message: String(err && err.message) });
      }
    });
  }

  // 주입 실패 시 비차단 안내 배너를 띄운다(의존성 없음, innerHTML/이모지 미사용).
  function showFailureNotice(reason) {
    try {
      const existing = document.getElementById("momently-publisher-notice");
      if (existing) existing.remove();

      const banner = document.createElement("div");
      banner.id = "momently-publisher-notice";
      banner.setAttribute("role", "alert");
      banner.style.cssText = [
        "position:fixed",
        "top:12px",
        "right:12px",
        "z-index:2147483647",
        "max-width:360px",
        "padding:12px 14px",
        "background:#b00020",
        "color:#fff",
        "font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif",
        "border-radius:8px",
        "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
      ].join(";");
      banner.textContent =
        "네이버 에디터에 자동 입력하지 못했습니다. 제목/본문 자동 입력을 건너뜁니다. (사유: " +
        reason +
        ")";
      document.body.appendChild(banner);
    } catch (err) {
      console.warn("[momently-publisher] 안내 배너 표시 실패", err);
    }
    console.warn(
      "[momently-publisher] SmartEditor 주입 실패 — 사유=" + reason
    );
  }

  async function handlePublish(payload) {
    const title = payload && typeof payload.title === "string" ? payload.title : "";
    const bodyText =
      payload && typeof payload.bodyText === "string" ? payload.bodyText : "";

    let result;
    try {
      result = await injectViaMainWorld({ title, bodyText });
    } catch (err) {
      result = { ok: false, reason: "INJECT_EXCEPTION", message: String(err && err.message) };
    }

    if (!result || !result.ok) {
      showFailureNotice((result && result.reason) || "UNKNOWN");
    }
    return result;
  }

  // ── Background 와의 port 기반 relay seam ──
  // background → (이 bridge) 방향으로 검증된 publish payload 가 내려온다.
  try {
    const port = chrome.runtime.connect({ name: RELAY_PORT_NAME });
    port.onMessage.addListener((message) => {
      if (message === null || typeof message !== "object") return;
      if (message.type !== PUBLISH_MESSAGE_TYPE) return;
      handlePublish(message.payload).then((result) => {
        try {
          port.postMessage({ type: RESULT_MESSAGE_TYPE, result });
        } catch (err) {
          console.warn("[momently-publisher] relay 결과 전송 실패", err);
        }
      });
    });
  } catch (err) {
    console.warn("[momently-publisher] background relay 연결 실패", err);
  }
})();

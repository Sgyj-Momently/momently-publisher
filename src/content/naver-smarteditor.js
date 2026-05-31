// content/naver-smarteditor.js — runs on blog.naver.com 글쓰기 페이지.
//
// Manifest V3 content scripts 는 모든 환경에서 ES module import 를 쓸 수 없다.
// 따라서 이 파일은 의도적으로 dependency-free 다. 셀렉터와 find/inject 의 최소
// 로직을 여기 인라인으로 복제한다. 단일 출처는 src/lib/naver-selectors.js 와
// src/lib/smarteditor-inject.js 이며, 그 모듈들은 단위 테스트로 검증된다.
// TODO(7c): 번들러(esbuild 등)를 도입하면 이 복제를 제거하고 lib 모듈을 직접
//           import 한다. 지금은 의존성 없는 단순함을 우선한다.
//
// ⚠️ ADR 007 hard constraints:
//   - 발행/등록(submit) 버튼은 절대 클릭/제출하지 않는다. 필드 채우기만 한다.
//   - Naver 세션/쿠키에 접근하지 않는다. DOM 주입만 한다.
//   - 셀렉터 불일치 시 조용히 죽지 않고 사용자에게 안내 배너를 띄운다.

(() => {
  // ── PLACEHOLDER 셀렉터 (PoC 필요) — lib/naver-selectors.js 와 동기화 유지 ──
  // 실제 값은 blog.naver.com 글쓰기 페이지를 inspect 한 PoC 에서 채운다.
  const SELECTORS = {
    titleInput: [
      "__PLACEHOLDER_TITLE_SELECTOR_PRIMARY__",
      "__PLACEHOLDER_TITLE_SELECTOR_FALLBACK__",
    ],
    bodyEditable: [
      "__PLACEHOLDER_BODY_SELECTOR_PRIMARY__",
      "__PLACEHOLDER_BODY_SELECTOR_FALLBACK__",
    ],
  };

  const RELAY_PORT_NAME = "momently/naver-relay";
  const PUBLISH_MESSAGE_TYPE = "momently/publish-to-naver";

  // schema.js 와 동일한 제어문자 정책.
  const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

  function stripControlChars(s) {
    if (typeof s !== "string") return "";
    return s.replace(CONTROL_CHAR_RE, "");
  }

  function findFirst(selectorList) {
    if (!Array.isArray(selectorList)) return null;
    for (const selector of selectorList) {
      if (typeof selector !== "string" || selector.length === 0) continue;
      let el = null;
      try {
        el = document.querySelector(selector);
      } catch {
        continue;
      }
      if (el) return el;
    }
    return null;
  }

  function dispatchInput(el) {
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      // 비치명적.
    }
  }

  function injectTitleAndBody({ title, bodyText }) {
    const titleEl = findFirst(SELECTORS.titleInput);
    const bodyEl = findFirst(SELECTORS.bodyEditable);

    const missing = [];
    if (!titleEl) missing.push("title");
    if (!bodyEl) missing.push("body");
    if (missing.length > 0) {
      return { ok: false, reason: "SELECTOR_NOT_FOUND", missing };
    }

    const safeTitle = stripControlChars(title);
    const safeBody = stripControlChars(bodyText);

    const titleTag = (titleEl.tagName || "").toLowerCase();
    if (titleTag === "input" || titleTag === "textarea") {
      titleEl.value = safeTitle;
    } else {
      titleEl.textContent = safeTitle;
    }
    dispatchInput(titleEl);

    const bodyTag = (bodyEl.tagName || "").toLowerCase();
    if (bodyTag === "input" || bodyTag === "textarea") {
      bodyEl.value = safeBody;
    } else {
      bodyEl.textContent = "";
      bodyEl.appendChild(document.createTextNode(safeBody));
    }
    dispatchInput(bodyEl);

    return { ok: true, injected: { title: true, body: true } };
  }

  // 셀렉터 불일치 등 실패 시 비차단 안내 배너를 띄운다(의존성 없음, 이모지 없음).
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
        "네이버 에디터 구조가 바뀌어 확장 업데이트가 필요합니다. " +
        "제목/본문 자동 입력을 건너뜁니다. (사유: " + reason + ")";
      document.body.appendChild(banner);
    } catch (err) {
      // 배너조차 못 띄우는 환경이면 콘솔로라도 알린다.
      console.warn("[momently-publisher] 안내 배너 표시 실패", err);
    }
    console.warn(
      "[momently-publisher] SmartEditor 주입 실패 — 네이버 에디터 구조가 바뀌어 확장 업데이트가 필요합니다. 사유=" +
        reason
    );
  }

  function handlePublish(payload) {
    const title = payload && typeof payload.title === "string" ? payload.title : "";
    const bodyText =
      payload && typeof payload.bodyText === "string" ? payload.bodyText : "";

    let result;
    try {
      result = injectTitleAndBody({ title, bodyText });
    } catch (err) {
      result = { ok: false, reason: "INJECT_EXCEPTION", message: String(err && err.message) };
    }

    if (!result.ok) {
      showFailureNotice(result.reason);
    }
    return result;
  }

  // ── Background 와의 port 기반 relay seam ──
  // background → (이 content script) 방향으로 검증된 publish payload 가 내려온다.
  // port 기반이라 'tabs' 권한이 필요 없다(background 가 탭을 직접 조회하지 않음).
  try {
    const port = chrome.runtime.connect({ name: RELAY_PORT_NAME });
    port.onMessage.addListener((message) => {
      if (message === null || typeof message !== "object") return;
      if (message.type !== PUBLISH_MESSAGE_TYPE) return;
      const result = handlePublish(message.payload);
      try {
        port.postMessage({ type: "momently/publish-to-naver-result", result });
      } catch (err) {
        console.warn("[momently-publisher] relay 결과 전송 실패", err);
      }
    });
  } catch (err) {
    console.warn("[momently-publisher] background relay 연결 실패", err);
  }
})();

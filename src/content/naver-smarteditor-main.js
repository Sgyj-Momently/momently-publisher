// content/naver-smarteditor-main.js — runs in the PAGE'S JS context (world: MAIN).
//
// 일반 content script 는 ISOLATED world 라 page 의 window.SmartEditor 를 볼 수 없다.
// 이 스크립트는 manifest 의 "world": "MAIN" 으로 page context 에서 실행되어
// window.SmartEditor 에 접근한다. 단, chrome.runtime 은 쓸 수 없다 → 그래서
// ISOLATED bridge(naver-bridge.js)와 window.postMessage 로만 통신한다.
//
// all_frames:true 로 모든 frame 에 주입되므로, editor 가 있는 frame(#mainFrame)
// 에서만 동작하도록 window.SmartEditor 존재를 가드한다.
//
// MV3 content script 는 ES module import 를 쓸 수 없으므로 smarteditor-document.js
// 의 필요한 로직을 여기 인라인으로 복제한다(단일 출처는 그 lib + 단위 테스트).
// TODO(bundler): esbuild 등 번들러 도입 시 이 복제를 제거하고 lib 를 직접 import.
//
// ⚠️ ADR 007 hard constraint: 발행/등록(publish/submit) 메서드는 절대 호출하지 않는다.

(() => {
  // window.SmartEditor 자체가 없는 frame(상위 document·버퍼 iframe 등)에서는 즉시 종료.
  // editor frame 에서만 아래 listener 가 살아있게 한다. (_editors 는 document_idle
  // 시점에 아직 안 채워졌을 수 있어 여기서는 SmartEditor 존재만 가드하고, 실제
  // editor 준비 여부는 요청 처리 시점에 짧게 poll 한다.)
  if (!window.SmartEditor) return;

  const REQUEST_TYPE = "momently/se-inject";
  const RESULT_TYPE = "momently/se-inject-result";

  // ── smarteditor-document.js 인라인 복제 (TODO(bundler)) ──
  const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

  function stripControlChars(s) {
    if (typeof s !== "string") return "";
    return s.replace(CONTROL_CHAR_RE, "");
  }

  function genId() {
    let uuid;
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        uuid = crypto.randomUUID();
      }
    } catch {
      uuid = undefined;
    }
    if (!uuid) {
      uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
    return "SE-" + uuid;
  }

  function buildParagraphs(bodyText) {
    const raw = typeof bodyText === "string" ? bodyText : "";
    const lines = raw.split("\n");
    if (lines.length === 0) lines.push("");
    return lines.map((line) => {
      const value = stripControlChars(line);
      return {
        id: genId(),
        nodes: [{ id: genId(), value, "@ctype": "textNode" }],
        "@ctype": "paragraph",
      };
    });
  }

  function locateEditor(win) {
    try {
      const se = win && win.SmartEditor;
      if (!se || !se._editors || typeof se._editors !== "object") return null;
      const keys = Object.keys(se._editors);
      if (keys.length === 0) return null;
      return se._editors[keys[0]] || null;
    } catch {
      return null;
    }
  }

  function applyToEditor(editor, { title, bodyText }) {
    if (
      !editor ||
      typeof editor.setDocumentTitle !== "function" ||
      typeof editor.getDocumentData !== "function" ||
      typeof editor.setDocumentData !== "function"
    ) {
      return { ok: false, reason: "EDITOR_API_MISSING" };
    }
    try {
      const safeTitle = stripControlChars(typeof title === "string" ? title : "");
      editor.setDocumentTitle(safeTitle);

      const dd = editor.getDocumentData();
      const components =
        dd && dd.document && Array.isArray(dd.document.components)
          ? dd.document.components
          : null;
      const textComponent = components
        ? components.find((c) => c && c["@ctype"] === "text")
        : null;
      if (!textComponent) {
        return { ok: false, reason: "NO_TEXT_COMPONENT" };
      }
      textComponent.value = buildParagraphs(bodyText);
      editor.setDocumentData(dd);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "INJECT_EXCEPTION",
        message: String(err && err.message),
      };
    }
  }
  // ── 인라인 복제 끝 ──

  // editor 준비를 짧게 기다리는 poll 상한. bridge timeout(4s)보다 작게.
  const READY_MAX_TRIES = 20; // 20 × 100ms = 2s
  const READY_POLL_MS = 100;

  window.addEventListener("message", (event) => {
    // intra-page MAIN↔ISOLATED: 같은 window/origin 만 신뢰.
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.type !== REQUEST_TYPE) return;

    // 요청 nonce 를 결과에 echo 한다. 같은 MAIN world 의 page 스크립트가 가짜 결과를
    // 끼워넣거나 동시 주입이 교차하는 것을 bridge 측에서 nonce 매칭으로 거른다.
    const nonce = typeof data.nonce === "string" ? data.nonce : null;
    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    const title = typeof payload.title === "string" ? payload.title : "";
    const bodyText = typeof payload.bodyText === "string" ? payload.bodyText : "";

    const reply = (result) => {
      try {
        window.postMessage({ type: RESULT_TYPE, nonce, result }, location.origin);
      } catch {
        // 비치명적 — bridge 측 timeout 이 처리한다.
      }
    };

    // _editors 가 document_idle 시점에 아직 안 채워졌을 수 있으므로 짧게 poll 한다.
    let tries = 0;
    const attempt = () => {
      let result;
      try {
        const editor = locateEditor(window);
        if (!editor) {
          if (tries++ < READY_MAX_TRIES) {
            setTimeout(attempt, READY_POLL_MS);
            return;
          }
          result = { ok: false, reason: "EDITOR_NOT_FOUND" };
        } else {
          result = applyToEditor(editor, { title, bodyText });
        }
      } catch (err) {
        result = { ok: false, reason: "INJECT_EXCEPTION", message: String(err && err.message) };
      }
      reply(result);
    };
    attempt();
  });
})();

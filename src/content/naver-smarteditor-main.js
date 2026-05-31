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
  // editor 가 없는 frame(상위 document 등)에서는 즉시 종료. 단, 메시지 핸들러는
  // 등록해 두지 않는다 — editor frame 에서만 listener 가 살아있게 한다.
  if (!window.SmartEditor || !window.SmartEditor._editors) return;

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

  window.addEventListener("message", (event) => {
    // intra-page MAIN↔ISOLATED: 같은 window/origin 만 신뢰.
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.type !== REQUEST_TYPE) return;

    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    const title = typeof payload.title === "string" ? payload.title : "";
    const bodyText = typeof payload.bodyText === "string" ? payload.bodyText : "";

    let result;
    try {
      const editor = locateEditor(window);
      if (!editor) {
        result = { ok: false, reason: "EDITOR_NOT_FOUND" };
      } else {
        result = applyToEditor(editor, { title, bodyText });
      }
    } catch (err) {
      result = { ok: false, reason: "INJECT_EXCEPTION", message: String(err && err.message) };
    }

    try {
      window.postMessage({ type: RESULT_TYPE, result }, location.origin);
    } catch {
      // 비치명적 — bridge 측 timeout 이 처리한다.
    }
  });
})();

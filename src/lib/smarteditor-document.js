// smarteditor-document.js — PURE SmartEditor ONE document builders/applier.
//
// 7b 재작성: 셀렉터+textContent 접근(구버전)을 폐기하고 SmartEditor 내부 JS API 로
// 주입한다. blog.naver.com PostWriteForm.naver iframe(#mainFrame) 의 page window 에
// 존재하는 window.SmartEditor 를 통해서만 동작한다(MAIN world). 이 모듈은 그 window
// 의존을 인자(editor/win)로 받아 순수하게 만든 부분이며, 단위 테스트로 검증된다.
//
// SmartEditor ONE 문서 모델(PoC 로 실제 확인):
//   document.components: 배열. 본문은 @ctype === "text" 컴포넌트.
//   text 컴포넌트의 value: paragraph 배열.
//   paragraph: { id, nodes: [{ id, value, "@ctype": "textNode" }], "@ctype": "paragraph" }
//
// ⚠️ ADR 007 hard constraint: 발행/등록(publish/submit) 류 메서드는 절대 호출하지
//    않는다. 이 모듈은 제목/본문만 채운다. 사용자가 직접 발행한다.

// schema.js 와 동일한 제어문자 정책: \x00-\x08, \x0B-\x1F, \x7F 제거.
// \n(0x0A), \t(0x09) 는 유지. \r(0x0D) 은 \x0B-\x1F 범위에 포함되어 제거된다.
// 주의: \n 은 paragraph 구분자이므로 split 후 줄 단위로 제거한다.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

function stripControlChars(s) {
  if (typeof s !== "string") return "";
  return s.replace(CONTROL_CHAR_RE, "");
}

// "SE-" + uuid. crypto.randomUUID 가 없는 환경(구형/제약) 대비 fallback 포함.
export function genId() {
  let uuid;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      uuid = crypto.randomUUID();
    }
  } catch {
    uuid = undefined;
  }
  if (!uuid) {
    // 비암호학적 fallback — SmartEditor 는 단순히 고유 id 만 요구한다.
    uuid =
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  }
  return "SE-" + uuid;
}

// 본문 문자열을 SmartEditor paragraph 배열로 변환한다.
//   - \n 으로 줄을 나눈 뒤 각 줄을 paragraph 하나로 만든다.
//   - 각 줄은 제어문자를 제거한다(\n 은 이미 split 되었으므로 여기서 안 만난다).
//   - 빈 입력이면 빈 paragraph 하나를 반환한다(0개 금지 — SmartEditor 가 최소 1개 요구).
export function buildParagraphs(bodyText) {
  const raw = typeof bodyText === "string" ? bodyText : "";
  const lines = raw.split("\n");
  // split 결과는 항상 길이 >= 1 이지만, 명시적으로 최소 1개를 보장한다.
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

// win.SmartEditor._editors 에서 첫 editor 인스턴스를 반환한다. 없으면 null.
// _editors 는 객체({ "blogpc001": editorInstance, ... })이며 첫 key 를 사용한다.
export function locateEditor(win) {
  try {
    const se = win && win.SmartEditor;
    if (!se || !se._editors || typeof se._editors !== "object") return null;
    const keys = Object.keys(se._editors);
    if (keys.length === 0) return null;
    const editor = se._editors[keys[0]];
    return editor || null;
  } catch {
    return null;
  }
}

// editor 에 제목/본문을 주입한다.
//   성공: { ok: true }
//   실패: { ok: false, reason, [message] }
// reason: EDITOR_API_MISSING | NO_TEXT_COMPONENT | INJECT_EXCEPTION
//
// ⚠️ publish/submit 류 메서드는 어떤 경로에서도 호출하지 않는다.
export function applyToEditor(editor, { title, bodyText }) {
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

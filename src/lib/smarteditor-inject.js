// smarteditor-inject.js — PURE DOM injection helpers for Naver SmartEditor.
//
// 모든 함수는 document(doc) 를 인자로 받는다. 전역(window/document)에 의존하지
// 않으므로 jsdom mock 으로 단위 테스트가 가능하다. 7b 는 "주입 메커니즘 + graceful
// failure" 만 다룬다. 리치 마크다운 렌더링(본문 서식)은 7d 의 몫이다.
//
// ⚠️ ADR 007 hard constraint: 발행/등록(submit) 요소는 절대 조회·클릭하지 않는다.
//    이 모듈은 title/body 필드를 채우기만 한다. 사용자가 직접 발행한다.

// schema.js 와 동일한 제어문자 정책: \x00-\x08, \x0B-\x1F, \x7F 제거.
// \n(0x0A), \t(0x09) 는 유지. \r(0x0D) 은 \x0B-\x1F 범위에 포함되어 제거된다.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

function stripControlChars(s) {
  if (typeof s !== "string") return "";
  return s.replace(CONTROL_CHAR_RE, "");
}

// 후보 셀렉터 목록을 순서대로 시도해 첫 매칭 Element 를 반환. 없으면 null.
// Naver 가 DOM 을 바꿔도 fallback 셀렉터로 버틸 수 있게 한다.
export function findFirst(doc, selectorList) {
  if (!doc || typeof doc.querySelector !== "function") return null;
  if (!Array.isArray(selectorList)) return null;
  for (const selector of selectorList) {
    if (typeof selector !== "string" || selector.length === 0) continue;
    let el = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      // 잘못된 셀렉터 문자열은 건너뛴다(graceful).
      continue;
    }
    if (el) return el;
  }
  return null;
}

// 제목 요소에 값을 세팅. input/textarea 면 value, 그 외(contenteditable)면 textContent.
// 에디터가 변경을 인지하도록 'input' 이벤트를 디스패치한다.
function setTitleValue(doc, el, value) {
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") {
    el.value = value;
  } else {
    // contenteditable 형태의 제목 영역 대비.
    el.textContent = value;
  }
  dispatchInput(doc, el);
}

// 본문 contenteditable 에 평문 텍스트를 삽입. 7b 는 단순 텍스트만(서식 없음).
// 기존 내용을 비우고 text node 하나로 채운 뒤 'input' 이벤트를 디스패치한다.
function setBodyText(doc, el, value) {
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") {
    el.value = value;
  } else {
    el.textContent = "";
    el.appendChild(doc.createTextNode(value));
  }
  dispatchInput(doc, el);
}

function dispatchInput(doc, el) {
  try {
    const view = (doc && doc.defaultView) || (typeof globalThis !== "undefined" ? globalThis : undefined);
    const EventCtor = view && view.Event ? view.Event : (typeof Event !== "undefined" ? Event : null);
    if (EventCtor && typeof el.dispatchEvent === "function") {
      el.dispatchEvent(new EventCtor("input", { bubbles: true }));
    }
  } catch {
    // 이벤트 디스패치 실패는 치명적이지 않다 — 값은 이미 세팅됨.
  }
}

// 제목과 본문을 주입한다.
//   성공: { ok: true, injected: { title: bool, body: bool } }
//   실패(필수 요소 부재): { ok: false, reason: 'SELECTOR_NOT_FOUND', missing: [...] }
// title/bodyText 는 schema.js 와 동일 정책으로 제어문자를 제거한 뒤 주입한다.
export function injectTitleAndBody(doc, { title, bodyText }, selectors) {
  const sel = selectors || {};
  const titleEl = findFirst(doc, sel.titleInput);
  const bodyEl = findFirst(doc, sel.bodyEditable);

  const missing = [];
  if (!titleEl) missing.push("title");
  if (!bodyEl) missing.push("body");

  if (missing.length > 0) {
    // graceful failure — 크래시 없이 구조화된 실패를 반환한다.
    return { ok: false, reason: "SELECTOR_NOT_FOUND", missing };
  }

  const safeTitle = stripControlChars(title);
  const safeBody = stripControlChars(bodyText);

  setTitleValue(doc, titleEl, safeTitle);
  setBodyText(doc, bodyEl, safeBody);

  return { ok: true, injected: { title: true, body: true } };
}

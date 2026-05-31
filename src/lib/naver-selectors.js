// naver-selectors.js — single source of truth for Naver SmartEditor selectors.
//
// ⚠️ PLACEHOLDER VALUES — PoC REQUIRED ⚠️
// 우리는 실제 Naver 로그인 세션이 없어 SmartEditor 의 실제 DOM 구조를 모른다.
// 따라서 아래 값들은 전부 PLACEHOLDER 다. 실제 값은 별도 수동 PoC 단계에서
// 진짜 blog.naver.com 글쓰기(SmartEditor ONE) 페이지를 열고 제목/본문 요소를
// 개발자도구로 직접 inspect 해서 채워야 한다. 그 전까지 이 모듈은 "주입 메커니즘"과
// "graceful failure" 만 검증하는 스켈레톤이다.
//
// 각 항목은 후보 셀렉터의 ARRAY 다(fallback order). Naver 는 DOM 을 자주 바꾸므로
// 앞에서부터 순서대로 시도하고, 첫 매칭 요소를 사용한다.
//
// 본문(bodyEditable)은 contenteditable 영역이라고 가정한다. 실제 SmartEditor ONE 은
// iframe 안에 본문이 들어있을 수 있다(아래 best-guess 참고). 그 경우 content script
// 에서 iframe 접근/문서 전환 로직이 추가로 필요하며, 이는 PoC 후 7c/7d 에서 다룬다.
//
// ── best guess (UNVERIFIED, 절대 그대로 신뢰 금지) ────────────────────────────
// 과거 SmartEditor ONE 관찰 기반의 "추측"일 뿐이다. 활성값으로 쓰지 않는다.
//   titleInput  추측: '.se-section-documentTitle .se-text-paragraph',
//                     'textarea.se_textarea', 'input.se-title'
//   bodyEditable 추측: '.se-component-content .se-text-paragraph',
//                     '[contenteditable="true"].se-text', 'div.se-main-container'
// ─────────────────────────────────────────────────────────────────────────────

export const NAVER_SMARTEDITOR_SELECTORS = {
  // 제목 입력 요소. 실제로는 input/textarea 또는 contenteditable 일 수 있다.
  // injectTitleAndBody 는 value 세팅 + 'input' 이벤트 디스패치를 시도한다.
  titleInput: [
    "__PLACEHOLDER_TITLE_SELECTOR_PRIMARY__",
    "__PLACEHOLDER_TITLE_SELECTOR_FALLBACK__",
  ],

  // 본문 입력 요소(contenteditable 가정). textContent / text node 로 채운다.
  bodyEditable: [
    "__PLACEHOLDER_BODY_SELECTOR_PRIMARY__",
    "__PLACEHOLDER_BODY_SELECTOR_FALLBACK__",
  ],

  // 발행/등록 버튼 — ⚠️ 절대 클릭/제출하지 않는다(ADR 007 hard constraint).
  // 여기 둔 이유는 오직 "건드리면 안 되는 대상"을 명시적으로 문서화하기 위함이며,
  // inject 로직은 이 셀렉터를 조회조차 하지 않는다. 사용자가 직접 발행한다.
  // 값 역시 PLACEHOLDER 다.
  publishButton: ["__PLACEHOLDER_PUBLISH_BUTTON_SELECTOR__"],
};

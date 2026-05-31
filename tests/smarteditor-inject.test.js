// @vitest-environment jsdom
//
// jsdom 환경은 이 파일에만 적용된다(다른 node-env 테스트는 영향 없음).
// 실제 Naver 셀렉터를 모르므로, 테스트는 PLACEHOLDER 셀렉터에 매칭되는 mock
// 요소를 직접 구성한다. 따라서 실제 Naver DOM 과 무관하게 self-consistent 하다.

import { describe, it, expect, vi } from "vitest";
import { findFirst, injectTitleAndBody } from "../src/lib/smarteditor-inject.js";

// lib/naver-selectors.js 의 PLACEHOLDER 와 동일한 셀렉터 형태를 테스트 전용으로
// 정의한다. CSS 셀렉터로 유효한 클래스 형태를 쓰되 placeholder 임을 명시한다.
const TEST_SELECTORS = {
  titleInput: [".placeholder-title-primary", ".placeholder-title-fallback"],
  bodyEditable: [".placeholder-body-primary", ".placeholder-body-fallback"],
  publishButton: [".placeholder-publish-button"],
};

// 제목 input + 본문 contenteditable + (절대 건드리면 안 되는) 발행 버튼을 갖춘
// mock 문서를 만든다. 발행 버튼에는 click spy 를 단다.
function buildMockDoc({ titleClass, bodyClass, withPublish = true } = {}) {
  document.body.innerHTML = "";

  const title = document.createElement("input");
  title.type = "text";
  if (titleClass) title.className = titleClass;
  document.body.appendChild(title);

  const body = document.createElement("div");
  body.setAttribute("contenteditable", "true");
  if (bodyClass) body.className = bodyClass;
  document.body.appendChild(body);

  let publishSpy = null;
  if (withPublish) {
    const publish = document.createElement("button");
    publish.className = "placeholder-publish-button";
    publish.textContent = "발행";
    publishSpy = vi.fn();
    publish.addEventListener("click", publishSpy);
    document.body.appendChild(publish);
  }

  return { doc: document, title, body, publishSpy };
}

describe("findFirst", () => {
  it("returns the first matching element trying fallbacks in order", () => {
    buildMockDoc({ titleClass: "placeholder-title-fallback", bodyClass: "placeholder-body-primary" });
    // primary 부재, fallback 존재 → fallback 매칭.
    const el = findFirst(document, TEST_SELECTORS.titleInput);
    expect(el).not.toBeNull();
    expect(el.classList.contains("placeholder-title-fallback")).toBe(true);
  });

  it("returns null when no candidate matches", () => {
    buildMockDoc({ titleClass: "nope", bodyClass: "nope" });
    expect(findFirst(document, TEST_SELECTORS.titleInput)).toBeNull();
  });

  it("skips invalid selector strings without throwing", () => {
    buildMockDoc({ titleClass: "placeholder-title-primary" });
    const el = findFirst(document, ["", ":::bad:::", ".placeholder-title-primary"]);
    expect(el).not.toBeNull();
  });
});

describe("injectTitleAndBody", () => {
  it("happy path: injects title + body and returns ok", () => {
    const { doc, title, body, publishSpy } = buildMockDoc({
      titleClass: "placeholder-title-primary",
      bodyClass: "placeholder-body-primary",
    });

    const result = injectTitleAndBody(
      doc,
      { title: "모먼틀리 제목", bodyText: "본문 텍스트입니다." },
      TEST_SELECTORS
    );

    expect(result).toEqual({ ok: true, injected: { title: true, body: true } });
    expect(title.value).toBe("모먼틀리 제목");
    expect(body.textContent).toBe("본문 텍스트입니다.");
    // 발행 버튼은 절대 트리거되지 않는다.
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("dispatches an input event on the title so the editor registers it", () => {
    const { doc, title } = buildMockDoc({
      titleClass: "placeholder-title-primary",
      bodyClass: "placeholder-body-primary",
    });
    const spy = vi.fn();
    title.addEventListener("input", spy);

    injectTitleAndBody(doc, { title: "T", bodyText: "B" }, TEST_SELECTORS);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("selector not found → ok:false, reason SELECTOR_NOT_FOUND, both missing", () => {
    const { doc, publishSpy } = buildMockDoc({ titleClass: "nope", bodyClass: "nope" });
    const result = injectTitleAndBody(doc, { title: "T", bodyText: "B" }, TEST_SELECTORS);
    expect(result).toEqual({
      ok: false,
      reason: "SELECTOR_NOT_FOUND",
      missing: ["title", "body"],
    });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("reports only the missing field (body present, title absent)", () => {
    const { doc } = buildMockDoc({ titleClass: "nope", bodyClass: "placeholder-body-primary" });
    const result = injectTitleAndBody(doc, { title: "T", bodyText: "B" }, TEST_SELECTORS);
    expect(result).toEqual({
      ok: false,
      reason: "SELECTOR_NOT_FOUND",
      missing: ["title"],
    });
  });

  it("uses fallback selector when the primary is absent", () => {
    const { doc, title, body } = buildMockDoc({
      titleClass: "placeholder-title-fallback",
      bodyClass: "placeholder-body-fallback",
    });
    const result = injectTitleAndBody(
      doc,
      { title: "fb 제목", bodyText: "fb 본문" },
      TEST_SELECTORS
    );
    expect(result.ok).toBe(true);
    expect(title.value).toBe("fb 제목");
    expect(body.textContent).toBe("fb 본문");
  });

  it("strips control chars from title and body, keeping \\n and \\t", () => {
    const { doc, title, body } = buildMockDoc({
      titleClass: "placeholder-title-primary",
      bodyClass: "placeholder-body-primary",
    });
    // \x00 NUL, \x07 BEL, \r CR, \x7F DEL 은 제거. \n, \t 는 유지.
    const dirtyTitle = "제\x00목\x07\r입니다";
    const dirtyBody = "본문\n탭\t유지\x7F됨\r";

    const result = injectTitleAndBody(
      doc,
      { title: dirtyTitle, bodyText: dirtyBody },
      TEST_SELECTORS
    );

    expect(result.ok).toBe(true);
    expect(title.value).toBe("제목입니다");
    expect(body.textContent).toBe("본문\n탭\t유지됨");
  });

  it("never triggers the publish button across all paths", () => {
    // 성공 경로.
    const ok = buildMockDoc({
      titleClass: "placeholder-title-primary",
      bodyClass: "placeholder-body-primary",
    });
    injectTitleAndBody(ok.doc, { title: "T", bodyText: "B" }, TEST_SELECTORS);
    expect(ok.publishSpy).not.toHaveBeenCalled();

    // 실패 경로(셀렉터 부재)에서도 발행 버튼은 존재하지만 트리거되지 않는다.
    const fail = buildMockDoc({ titleClass: "nope", bodyClass: "nope" });
    injectTitleAndBody(fail.doc, { title: "T", bodyText: "B" }, TEST_SELECTORS);
    expect(fail.publishSpy).not.toHaveBeenCalled();
  });
});

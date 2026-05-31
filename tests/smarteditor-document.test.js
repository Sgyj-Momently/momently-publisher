// node 환경(기본). 이 모듈은 순수 함수 + mock editor 객체로 검증되며 DOM 이 필요 없다.
//
// SmartEditor 실제 API/문서 모델은 PoC(Playwright)로 확인했고, 여기서는 그 모델을
// 흉내 낸 mock editor 로 applyToEditor 의 계약을 검증한다.

import { describe, it, expect, vi } from "vitest";
import {
  genId,
  buildParagraphs,
  applyToEditor,
  locateEditor,
} from "../src/lib/smarteditor-document.js";

describe("genId", () => {
  it("returns an SE- prefixed id", () => {
    const id = genId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("SE-")).toBe(true);
    expect(id.length).toBeGreaterThan(3);
  });
});

describe("buildParagraphs", () => {
  it("splits multi-line text into N paragraphs each with correct shape", () => {
    const paras = buildParagraphs("first\nsecond\nthird");
    expect(paras).toHaveLength(3);
    const values = paras.map((p) => p.nodes[0].value);
    expect(values).toEqual(["first", "second", "third"]);
    for (const p of paras) {
      expect(p["@ctype"]).toBe("paragraph");
      expect(typeof p.id).toBe("string");
      expect(p.id.startsWith("SE-")).toBe(true);
      expect(Array.isArray(p.nodes)).toBe(true);
      expect(p.nodes).toHaveLength(1);
      const node = p.nodes[0];
      expect(node["@ctype"]).toBe("textNode");
      expect(node.id.startsWith("SE-")).toBe(true);
      expect(typeof node.value).toBe("string");
    }
  });

  it("empty string → exactly one (empty) paragraph", () => {
    const paras = buildParagraphs("");
    expect(paras).toHaveLength(1);
    expect(paras[0].nodes[0].value).toBe("");
    expect(paras[0]["@ctype"]).toBe("paragraph");
  });

  it("non-string input → exactly one empty paragraph", () => {
    expect(buildParagraphs(undefined)).toHaveLength(1);
    expect(buildParagraphs(null)).toHaveLength(1);
  });

  it("strips control chars per line, keeping \\t (and \\n splits)", () => {
    // \x00 NUL, \x07 BEL, \r CR, \x7F DEL 제거. \t 유지. \n 은 paragraph 구분.
    const paras = buildParagraphs("제\x00목\x07\t유지\nbody\x7F\r끝");
    expect(paras).toHaveLength(2);
    expect(paras[0].nodes[0].value).toBe("제목\t유지");
    expect(paras[1].nodes[0].value).toBe("body끝");
  });

  it("uses \\n as the paragraph separator", () => {
    expect(buildParagraphs("a\nb")).toHaveLength(2);
    expect(buildParagraphs("a\n\nb")).toHaveLength(3); // 빈 줄도 paragraph
  });
});

// PoC 로 확인한 문서 모델을 흉내 낸 mock editor 를 만든다.
// publish/submit spy 를 달아 그 어떤 경로에서도 호출되지 않음을 검증한다.
function buildMockEditor({ withTextComponent = true } = {}) {
  const components = [
    { "@ctype": "image", value: [] },
  ];
  if (withTextComponent) {
    components.push({
      "@ctype": "text",
      value: [
        {
          id: "SE-old",
          nodes: [{ id: "SE-oldnode", value: "old body", "@ctype": "textNode" }],
          "@ctype": "paragraph",
        },
      ],
    });
  }
  const documentData = {
    document: {
      version: "2.8.10",
      theme: "default",
      language: "ko-KR",
      id: "doc-id",
      di: "di",
      components,
    },
    documentId: "doc-id",
  };

  const setDocumentTitle = vi.fn();
  const getDocumentData = vi.fn(() => documentData);
  const setDocumentData = vi.fn();
  const publish = vi.fn();
  const submit = vi.fn();

  return {
    editor: { setDocumentTitle, getDocumentData, setDocumentData, publish, submit },
    documentData,
    spies: { setDocumentTitle, getDocumentData, setDocumentData, publish, submit },
    getTextComponent: () => documentData.document.components.find((c) => c["@ctype"] === "text"),
  };
}

describe("applyToEditor", () => {
  it("happy path: sets sanitized title and replaces text component value", () => {
    const { editor, spies, getTextComponent } = buildMockEditor();

    const result = applyToEditor(editor, {
      title: "모먼틀리\x00 제목",
      bodyText: "line1\nline2",
    });

    expect(result).toEqual({ ok: true });
    expect(spies.setDocumentTitle).toHaveBeenCalledTimes(1);
    expect(spies.setDocumentTitle).toHaveBeenCalledWith("모먼틀리 제목");

    const text = getTextComponent();
    expect(text.value).toHaveLength(2);
    expect(text.value.map((p) => p.nodes[0].value)).toEqual(["line1", "line2"]);
    expect(text.value[0]["@ctype"]).toBe("paragraph");

    expect(spies.setDocumentData).toHaveBeenCalledTimes(1);
    // setDocumentData 는 갱신된 동일 문서 객체를 받는다.
    expect(spies.setDocumentData.mock.calls[0][0].document.components).toContain(text);
  });

  it("missing required API → EDITOR_API_MISSING", () => {
    expect(applyToEditor(null, { title: "t", bodyText: "b" })).toEqual({
      ok: false,
      reason: "EDITOR_API_MISSING",
    });
    expect(
      applyToEditor({ setDocumentTitle: () => {} }, { title: "t", bodyText: "b" })
    ).toEqual({ ok: false, reason: "EDITOR_API_MISSING" });
  });

  it("no text component → NO_TEXT_COMPONENT (title still attempted, body skipped)", () => {
    const { editor, spies } = buildMockEditor({ withTextComponent: false });
    const result = applyToEditor(editor, { title: "t", bodyText: "b" });
    expect(result).toEqual({ ok: false, reason: "NO_TEXT_COMPONENT" });
    expect(spies.setDocumentData).not.toHaveBeenCalled();
  });

  it("NEVER calls anything resembling publish/submit", () => {
    // 성공 경로.
    const ok = buildMockEditor();
    applyToEditor(ok.editor, { title: "t", bodyText: "b" });
    expect(ok.spies.publish).not.toHaveBeenCalled();
    expect(ok.spies.submit).not.toHaveBeenCalled();

    // text component 부재 경로.
    const noText = buildMockEditor({ withTextComponent: false });
    applyToEditor(noText.editor, { title: "t", bodyText: "b" });
    expect(noText.spies.publish).not.toHaveBeenCalled();
    expect(noText.spies.submit).not.toHaveBeenCalled();
  });
});

describe("locateEditor", () => {
  it("returns the first editor from win.SmartEditor._editors", () => {
    const first = { id: "blogpc001" };
    const win = { SmartEditor: { _editors: { blogpc001: first, blogpc002: {} } } };
    expect(locateEditor(win)).toBe(first);
  });

  it("returns null when SmartEditor / _editors absent or empty", () => {
    expect(locateEditor({})).toBeNull();
    expect(locateEditor({ SmartEditor: {} })).toBeNull();
    expect(locateEditor({ SmartEditor: { _editors: {} } })).toBeNull();
    expect(locateEditor(null)).toBeNull();
  });
});

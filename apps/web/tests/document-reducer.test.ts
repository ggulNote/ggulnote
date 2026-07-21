import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  documentSessionReducer,
  getInitialDocumentSessionState,
  type DocumentSessionState,
} from "@/features/document/model/document-state";
import { A4_PORTRAIT_POINTS } from "@/features/document/model/document-types";

describe("문서 세션 리듀서", () => {
  it("문서 로드를 시작하면 로딩 상태가 된다", () => {
    const initial = getInitialDocumentSessionState();
    const next = documentSessionReducer(initial, { type: "LOAD_STARTED" });

    expect(next.status).toBe("loading");
    expect(next.textItemCount).toBe(0);
    expect(next.renderedWidth).toBe(0);
  });

  it("PDF 로드 완료 시 페이지 번호가 1로 초기화된다", () => {
    const initial = getInitialDocumentSessionState();
    const next = documentSessionReducer(initial, {
      type: "PDF_LOADED",
      document: {
        id: "pdf-1",
        kind: "pdf",
        name: "sample.pdf",
        pageCount: 3,
      },
      pageCount: 3,
    });

    expect(next.status).toBe("ready");
    expect(next.currentPage).toBe(1);
    expect(next.totalPages).toBe(3);
    expect(next.document?.kind).toBe("pdf");
  });

  it("백지 생성 시 A4 페이지가 기본으로 들어간다", () => {
    const initial = getInitialDocumentSessionState();
    const next = documentSessionReducer(initial, {
      type: "BLANK_CREATED",
      document: {
        id: "blank-1",
        kind: "blank",
        name: "새 백지",
        pageCount: 1,
      },
      pageCount: 1,
    });

    expect(next.status).toBe("ready");
    expect(next.document?.kind).toBe("blank");
    expect(next.page?.width).toBe(A4_PORTRAIT_POINTS.width);
    expect(next.page?.height).toBe(A4_PORTRAIT_POINTS.height);
  });

  it("페이지 이동은 범위를 벗어나면 범위 내로 제한된다", () => {
    const initial = {
      ...getInitialDocumentSessionState(),
      status: "ready" as const,
      totalPages: 3,
    };

    const first = documentSessionReducer(initial, { type: "GO_TO_PAGE", page: 0 });
    expect(first.currentPage).toBe(1);

    const second = documentSessionReducer(initial, { type: "GO_TO_PAGE", page: 999 });
    expect(second.currentPage).toBe(3);
  });

  it("줌 값은 허용 범위로 고정된다", () => {
    let state = getInitialDocumentSessionState();
    state = {
      ...state,
      status: "ready",
      totalPages: 1,
      document: { id: "pdf", kind: "pdf", name: "test", pageCount: 1 },
    };

    expect(documentSessionReducer(state, { type: "SET_ZOOM", zoom: MIN_ZOOM - 10 }).zoom).toBe(MIN_ZOOM);
    expect(documentSessionReducer(state, { type: "SET_ZOOM", zoom: MAX_ZOOM + 10 }).zoom).toBe(MAX_ZOOM);
  });

  it("문서가 닫히면 초기 상태로 복귀한다", () => {
    const before = documentSessionReducer(
      getInitialDocumentSessionState(),
      {
        type: "BLANK_CREATED",
        document: {
          id: "blank-1",
          kind: "blank",
          name: "새 백지",
          pageCount: 1,
        },
        pageCount: 1,
      },
    );

    const next = documentSessionReducer(before, { type: "DOCUMENT_CLOSED" });
    expect(next.status).toBe("empty");
    expect(next.document).toBeNull();
    expect(next.currentPage).toBe(1);
    expect(next.totalPages).toBe(0);
  });
});

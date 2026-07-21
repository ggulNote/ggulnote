import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { DocumentWorkspace } from "@/features/document/components/document-workspace";
import type { DocumentSessionState } from "@/features/document/model/document-state";
import type { DocumentDescriptor } from "@/features/document/model/document-types";
import { A4_PORTRAIT_POINTS } from "@/features/document/model/document-types";

let mockState: DocumentSessionState = getInitialState();
let mockOpenPdfFile = vi.fn();
let mockOpenBlank = vi.fn();
let mockClose = vi.fn();
let mockGoToPage = vi.fn();
let mockSetZoom = vi.fn();
let mockSetZoomMode = vi.fn();
let mockSetPointer = vi.fn();
let mockRequestPageText = vi.fn();
let mockGetPage = vi.fn();
let mockDispatch = vi.fn();

function getInitialState(overrides: Partial<DocumentSessionState> = {}): DocumentSessionState {
  return {
    status: "empty",
    document: null,
    currentPage: 1,
    zoom: 100,
    zoomMode: "custom",
    page: null,
    textItemCount: 0,
    pointer: null,
    errorMessage: null,
    totalPages: 0,
    isPdfJsReady: false,
    isPdfWorkerReady: false,
    renderedWidth: 0,
    renderedHeight: 0,
    isTextLoading: false,
    ...overrides,
  };
}

vi.mock("@/features/document/hooks/use-document-session", () => ({
  useDocumentSession: () => ({
    state: mockState,
    openPdfFile: mockOpenPdfFile,
    openBlankDocument: mockOpenBlank,
    closeDocument: mockClose,
    goToPage: mockGoToPage,
    setZoom: mockSetZoom,
    setZoomMode: mockSetZoomMode,
    setPointer: mockSetPointer,
    requestPageText: mockRequestPageText,
    getPage: mockGetPage,
    dispatch: mockDispatch,
    document: mockState.document,
  }),
}));

afterEach(() => {
  cleanup();
  mockOpenPdfFile = vi.fn();
  mockOpenBlank = vi.fn();
  mockClose = vi.fn();
  mockGoToPage = vi.fn();
  mockSetZoom = vi.fn();
  mockSetZoomMode = vi.fn();
  mockSetPointer = vi.fn();
  mockRequestPageText = vi.fn();
  mockGetPage = vi.fn();
  mockDispatch = vi.fn();
});

describe("Editor workspace", () => {
  it("빈 상태에서 PDF 파일 열기와 새 백지 버튼이 보인다", () => {
    mockState = getInitialState();

    render(<DocumentWorkspace />);

    expect(screen.getByRole("heading", { name: "꿀노트" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF 파일 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 백지 만들기" })).toBeInTheDocument();
    expect(screen.getByText("문서를 불러와 주세요.")).toBeInTheDocument();
  });

  it("백지 생성 후 A4 기본 페이지를 표시한다", () => {
    const document: DocumentDescriptor = {
      id: "blank-1",
      kind: "blank",
      name: "새 백지",
      pageCount: 1,
    };

    mockState = getInitialState({
      status: "ready",
      document,
      totalPages: 1,
      page: {
        id: "blank-1-page-1",
        pageNumber: 1,
        width: A4_PORTRAIT_POINTS.width,
        height: A4_PORTRAIT_POINTS.height,
        rotation: 0,
      },
      renderedWidth: 595.28,
      renderedHeight: 841.89,
    });

    render(<DocumentWorkspace />);

    expect(screen.getByText("Blank Page (A4)")).toBeInTheDocument();
    expect(screen.getByText("문서 종류")).toBeInTheDocument();
  });

  it("현재 페이지가 첫 번째면 이전 버튼이 비활성", () => {
    mockState = getInitialState({
      status: "ready",
      document: {
        id: "pdf-1",
        kind: "pdf",
        name: "sample.pdf",
        pageCount: 1,
      },
      totalPages: 1,
    });

    render(<DocumentWorkspace />);

    expect(screen.getByRole("button", { name: /이전 페이지/i })).toBeDisabled();
  });

  it("현재 페이지가 마지막이면 다음 버튼이 비활성", () => {
    mockState = getInitialState({
      status: "ready",
      document: {
        id: "pdf-1",
        kind: "pdf",
        name: "sample.pdf",
        pageCount: 2,
      },
      totalPages: 2,
      currentPage: 2,
      page: {
        id: "pdf-1-page-2",
        pageNumber: 2,
        width: 612,
        height: 792,
        rotation: 0,
      },
      renderedWidth: 612,
      renderedHeight: 792,
    });

    render(<DocumentWorkspace />);

    expect(screen.getByRole("button", { name: /다음 페이지/i })).toBeDisabled();
  });

  it("로딩 상태 문구를 표시한다", () => {
    mockState = getInitialState({
      status: "loading",
      document: {
        id: "loading",
        kind: "pdf",
        name: "loading.pdf",
        pageCount: 0,
      },
    });

    render(<DocumentWorkspace />);

    expect(screen.getByText("문서를 처리하고 있습니다.")).toBeInTheDocument();
  });

  it("오류 상태에서 메시지를 표시한다", () => {
    mockState = getInitialState({
      status: "error",
      errorMessage: "잘못된 PDF 파일입니다.",
    });

    render(<DocumentWorkspace />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("잘못된 PDF 파일입니다.")).toBeInTheDocument();
  });

  it("문서 닫기 버튼을 누르면 닫기 핸들러가 호출된다", () => {
    mockState = getInitialState({
      status: "ready",
      document: {
        id: "blank-1",
        kind: "blank",
        name: "새 백지",
        pageCount: 1,
      },
      totalPages: 1,
      page: {
        id: "blank-1-page-1",
        pageNumber: 1,
        width: A4_PORTRAIT_POINTS.width,
        height: A4_PORTRAIT_POINTS.height,
        rotation: 0,
      },
    });

    render(<DocumentWorkspace />);

    const closeButton = screen.getByRole("button", { name: "문서 닫기" });
    fireEvent.click(closeButton);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("줌 값이 UI에 표시된다", () => {
    mockState = getInitialState({
      status: "ready",
      document: {
        id: "blank-1",
        kind: "blank",
        name: "새 백지",
        pageCount: 1,
      },
      totalPages: 1,
      page: {
        id: "blank-1-page-1",
        pageNumber: 1,
        width: A4_PORTRAIT_POINTS.width,
        height: A4_PORTRAIT_POINTS.height,
        rotation: 0,
      },
      zoom: 125,
    });

    render(<DocumentWorkspace />);

    expect(screen.getByText("125%")).toBeInTheDocument();
  });
});


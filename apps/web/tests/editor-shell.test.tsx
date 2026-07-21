import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EditorShell } from "@/features/editor/components/editor-shell";

afterEach(() => {
  cleanup();
});

describe("Editor shell", () => {
  it("문서 영역 placeholder를 표시한다", () => {
    render(<EditorShell />);

    expect(screen.getByText("다음 단계에서 PDF 및 백지 뷰어를 구현합니다.")).toBeInTheDocument();
  });

  it("주요 모듈 상태를 표시한다", () => {
    render(<EditorShell />);

    expect(screen.getByText("Document Engine")).toBeInTheDocument();
    expect(screen.getByText("Editor Engine")).toBeInTheDocument();
    expect(screen.getByText("Gaze Engine")).toBeInTheDocument();
    expect(screen.getByText("Voice Engine")).toBeInTheDocument();
  });

  it("구현되지 않은 버튼은 disabled로 표시한다", () => {
    render(<EditorShell />);

    expect(screen.getByRole("button", { name: /PDF 렌더링 시작/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /캔버스 도구 시작/i })).toBeDisabled();
  });
});

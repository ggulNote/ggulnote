import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DebugDashboard } from "@/features/debug/components/debug-dashboard";

afterEach(() => {
  cleanup();
});

describe("Debug dashboard", () => {
  it("실행 상태와 모듈 상태 목록을 표시한다", () => {
    render(
      <DebugDashboard
        environment="development"
        nextStatus="App Router 앱 상태"
        roadmap={[]}
        moduleStatus={[
          { name: "Document Engine", status: "미구현" },
          { name: "Gaze Engine", status: "준비 중" },
        ]}
        payload={{
          documentKind: "none",
          documentStatus: "empty",
          documentName: "-",
          currentPage: "-",
          pageCount: "-",
          zoom: "100%",
          zoomMode: "custom",
          originalWidth: "-",
          originalHeight: "-",
          renderedWidth: "-",
          renderedHeight: "-",
          pointerX: "-",
          pointerY: "-",
          textItemCount: "0",
          pdfJsLoaded: "not loaded",
          pdfWorkerLoaded: "not loaded",
        }}
      />
    );

    expect(screen.getByText("실행 상태")).toBeInTheDocument();
    expect(screen.getByText("Document Engine")).toBeInTheDocument();
    expect(screen.getByText("Gaze Engine")).toBeInTheDocument();
  });

  it("향후 모듈 목록을 표시한다", () => {
    render(
      <DebugDashboard
        environment="development"
        nextStatus="App Router 앱 상태"
        roadmap={[
          "PDF Document Engine",
          "Canvas Editor Core",
          "Gaze Engine",
          "Voice Engine",
          "Intent Gateway",
        ]}
        moduleStatus={[]}
        payload={{
          documentKind: "none",
          documentStatus: "empty",
          documentName: "-",
          currentPage: "-",
          pageCount: "-",
          zoom: "100%",
          zoomMode: "custom",
          originalWidth: "-",
          originalHeight: "-",
          renderedWidth: "-",
          renderedHeight: "-",
          pointerX: "-",
          pointerY: "-",
          textItemCount: "0",
          pdfJsLoaded: "not loaded",
          pdfWorkerLoaded: "not loaded",
        }}
      />
    );

    expect(screen.getByText("향후 모듈 목록")).toBeInTheDocument();
    expect(screen.getByText("Intent Gateway")).toBeInTheDocument();
  });

  it("문서 디버그 항목을 표시한다", () => {
    render(
      <DebugDashboard
        environment="development"
        nextStatus="App Router 앱 상태"
        roadmap={[]}
        moduleStatus={[
          { name: "Voice Engine", status: "준비 중" },
        ]}
        payload={{
          documentKind: "pdf",
          documentStatus: "ready",
          documentName: "sample.pdf",
          currentPage: "2",
          pageCount: "12",
          zoom: "125%",
          zoomMode: "custom",
          originalWidth: "612",
          originalHeight: "792",
          renderedWidth: "765",
          renderedHeight: "990",
          pointerX: "0.25",
          pointerY: "0.5",
          textItemCount: "42",
          pdfJsLoaded: "loaded",
          pdfWorkerLoaded: "loaded",
        }}
      />
    );

    expect(screen.getByText("sample.pdf")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("0.25")).toBeInTheDocument();
    expect(screen.getByText("pdf")).toBeInTheDocument();
  });
});

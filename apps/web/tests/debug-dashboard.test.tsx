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
        nextStatus="App Router 실행 중"
        roadmap={[]}
        moduleStatus={[{ name: "Document Engine", status: "미구현" }, { name: "Gaze Engine", status: "미구현" }]}
        payload={{
          page: "/debug",
          gazeCoordinate: "-",
          roi: "-",
          candidateCount: "0",
          actionPlan: "-",
          canvasObjects: "0",
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
        nextStatus="App Router 실행 중"
        roadmap={[
          "PDF Document Engine",
          "Canvas Editor Core",
          "Gaze Engine",
          "Voice Engine",
          "Intent Gateway",
        ]}
        moduleStatus={[]}
        payload={{
          page: "/debug",
          gazeCoordinate: "-",
          roi: "-",
          candidateCount: "0",
          actionPlan: "-",
          canvasObjects: "0",
        }}
      />
    );

    expect(screen.getByText("향후 모듈 목록")).toBeInTheDocument();
    expect(screen.getByText("Intent Gateway")).toBeInTheDocument();
  });

  it("디버그 placeholder 데이터를 표시한다", () => {
    render(
      <DebugDashboard
        environment="development"
        nextStatus="App Router 실행 중"
        roadmap={[]}
        moduleStatus={[]}
        payload={{
          page: "/debug",
          gazeCoordinate: "10, 20",
          roi: "[0, 0, 100, 100]",
          candidateCount: "1",
          actionPlan: "detect",
          canvasObjects: "2",
        }}
      />
    );

    expect(screen.getByText("테스트용 placeholder 데이터")).toBeInTheDocument();
    expect(screen.getByText("10, 20")).toBeInTheDocument();
    expect(screen.getByText("Action Plan")).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createVoiceDebugRuntime, type VoiceDebugRuntimeContract } from "./voice-debug-runtime";
import { VoiceDebugPanel } from "./voice-debug-panel";

let runtime: VoiceDebugRuntimeContract | undefined;

afterEach(() => {
  cleanup();
  runtime?.dispose();
  runtime = undefined;
});

describe("VoiceDebugPanel", () => {
  it("renders provider, turn, transcript, context, metrics and timeline sections", () => {
    runtime = createVoiceDebugRuntime("fake");
    render(<VoiceDebugPanel runtime={runtime} />);

    expect(screen.getByRole("heading", { name: "Provider" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Voice Turn" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transcript Debug" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frozen vs Current Context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Latency Metrics" })).toBeInTheDocument();
    expect(screen.getByText(/Event Timeline/)).toBeInTheDocument();
    expect(screen.getAllByText("Not measured").length).toBeGreaterThan(0);
  });

  it("runs the existing fake provider happy path and reflects completion", async () => {
    runtime = createVoiceDebugRuntime("fake");
    render(<VoiceDebugPanel runtime={runtime} />);

    fireEvent.click(screen.getByRole("button", { name: "Run Scenario" }));

    await waitFor(() => {
      expect(screen.getAllByText("이 문단에 노란색 하이라이트").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    }, { timeout: 2_000 });
  });
});

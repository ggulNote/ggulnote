import { describe, expect, it } from "vitest";
import type { NoteAgentShadowTrace } from "./note-agent-trace";
import { percentiles, summarizeNoteAgentLatency } from "./note-agent-latency";

describe("Note Agent latency diagnostics", () => {
  it("computes deterministic nearest-rank p50/p90/p95 by tool", () => {
    expect(percentiles([10, 20, 30, 40, 50])).toEqual({
      sampleCount: 5, p50: 30, p90: 50, p95: 50,
    });
    const traces = [10, 20, 30, 40, 50].map((value) => ({
      turnId: `turn-${value}`, pageId: "page-1", sceneRevision: 1,
      shadowMode: false, toolId: "math.add", resultStatus: "SUCCESS",
      llmCallCount: 1, toolCallCount: 1, decisionMs: value,
      runtimeMs: 1, totalMs: value + 2, endToVisibleMs: value + 3,
      commitAttempted: false, recordedAt: value,
    })) satisfies NoteAgentShadowTrace[];
    expect(summarizeNoteAgentLatency(traces)).toEqual([{
      toolId: "math.add",
      decisionMs: { sampleCount: 5, p50: 30, p90: 50, p95: 50 },
      endToVisibleMs: { sampleCount: 5, p50: 33, p90: 53, p95: 53 },
    }]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type {
  DirectCommandLifecycleTimestamps,
  DirectCommandTrace,
} from "../domain";
import {
  calculateDirectCommandLatencyMetrics,
  DirectCommandTraceStore,
} from "./direct-command-diagnostics";

function trace(turnId: string): DirectCommandTrace {
  const timestamps: DirectCommandLifecycleTimestamps = {
    voiceFinalizedAt: 5,
    routeReceivedAt: 10,
    plannerRequestedAt: 12,
    plannerCompletedAt: 22,
    resolverStartedAt: 23,
    resolverCompletedAt: 27,
    disambiguatorRequestedAt: 28,
    disambiguatorCompletedAt: 34,
    validationStartedAt: 35,
    validatedAt: 37,
    compileStartedAt: 38,
    compiledAt: 40,
    commitStartedAt: 41,
    committedAt: 45,
    routeCompletedAt: 46,
  };
  return {
    turnId,
    planId: "plan-" + turnId,
    plannerStatus: "EXECUTABLE",
    command: {
      capability: "annotation",
      operation: "underline",
      relation: "NEW",
    },
    targetQueryKind: "relative",
    resolutionStatus: "RESOLVED",
    resolvedTargetKind: "text_span",
    resolverConfidence: 0.9,
    disambiguationUsed: true,
    disambiguationResult: "SELECTED",
    guardStatus: "PASSED",
    executionStatus: "COMMITTED",
    editorOperationId: "op-1",
    timestamps,
    metrics: calculateDirectCommandLatencyMetrics(timestamps),
  };
}

describe("Direct command diagnostics", () => {
  it("calculates all Phase F durations from one clock domain", () => {
    expect(trace("turn-1").metrics).toEqual({
      plannerMs: 10,
      resolverMs: 4,
      disambiguatorMs: 6,
      validationMs: 2,
      compileMs: 2,
      commitMs: 4,
      directRouteMs: 36,
      voiceEndToCommitMs: 40,
    });
  });

  it("omits unavailable and negative durations instead of fabricating values", () => {
    expect(calculateDirectCommandLatencyMetrics({
      routeReceivedAt: 10,
      plannerRequestedAt: 20,
      plannerCompletedAt: 15,
      routeCompletedAt: 12,
    })).toEqual({ directRouteMs: 2 });
  });

  it("keeps a bounded structural trace and isolates observer failures", () => {
    const store = new DirectCommandTraceStore({ capacity: 2 });
    const observer = vi.fn(() => {
      throw new Error("observer failed");
    });
    store.subscribe(observer);

    store.record(trace("turn-1"));
    store.record(trace("turn-2"));
    store.record(trace("turn-3"));

    expect(store.getSnapshot().map((item) => item.turnId)).toEqual([
      "turn-2",
      "turn-3",
    ]);
    expect(observer).toHaveBeenCalledTimes(3);
    const serialized = JSON.stringify(store.getSnapshot());
    expect(serialized).not.toContain("rawTranscript");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("documentContext");
    expect(serialized).not.toContain("modelResponse");
  });
});

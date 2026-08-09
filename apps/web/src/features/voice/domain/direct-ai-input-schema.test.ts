import { describe, expect, it } from "vitest";
import {
  DirectAiInputValidationError,
  parseDirectCommandPlannerInput,
} from "./direct-ai-input-schema";

function plannerInput() {
  return {
    turn: {
      turnId: "turn-1",
      language: "ko-KR",
      rawFinalTranscript: "노란색 말고 파란색",
    },
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 1,
      focus: null,
    },
    lastOperation: {
      command: {
        capability: "annotation",
        operation: "highlight",
        target: { kind: "relative", relation: "focused" },
        payload: { color: "yellow" },
      },
      targetSummary: {
        source: "pdf",
        type: "line",
        text: "AI 문제 문장",
      },
    },
    allowedCommands: ["annotation.highlight"],
  };
}

describe("parseDirectCommandPlannerInput Phase E history", () => {
  it("accepts a navigation-safe last operation without an editor operation ID", () => {
    expect(parseDirectCommandPlannerInput(plannerInput())).toMatchObject({
      lastOperation: {
        command: {
          capability: "annotation",
          operation: "highlight",
        },
        targetSummary: {
          source: "pdf",
          type: "line",
          text: "AI 문제 문장",
        },
      },
    });
  });

  it("rejects internal candidate IDs in the planner target summary", () => {
    const input = plannerInput();
    const unsafe = {
      ...input,
      lastOperation: {
        ...input.lastOperation,
        targetSummary: {
          ...input.lastOperation.targetSummary,
          candidateId: "internal-candidate",
        },
      },
    };

    expect(() => parseDirectCommandPlannerInput(unsafe))
      .toThrow(DirectAiInputValidationError);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  DIRECT_COMMAND_NAMES,
  type DirectCommandPlannerInput,
  type DirectTargetDisambiguationInput,
} from "../domain";
import { HttpDirectCommandPlannerProvider } from "./http-direct-command-planner-provider";
import { HttpDirectTargetDisambiguatorProvider } from "./http-direct-target-disambiguator-provider";

const PLANNER_INPUT: DirectCommandPlannerInput = {
  turn: {
    turnId: "turn-1",
    language: "ko-KR",
    rawFinalTranscript: "다음 페이지",
  },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "page",
    focusStale: false,
    capturedAt: 1,
    focus: null,
  },
  allowedCommands: DIRECT_COMMAND_NAMES,
};

const DISAMBIGUATION_INPUT: DirectTargetDisambiguationInput = {
  turnId: "turn-1",
  rawFinalTranscript: "AI 문장",
  normalizedIntent: "AI 문장 선택",
  targetQuery: { kind: "semantic_unit", unit: "sentence", query: "AI" },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "page",
  },
  candidates: [
    { label: "C1", source: "pdf", type: "sentence", text: "첫 문장" },
    { label: "C2", source: "pdf", type: "sentence", text: "둘째 문장" },
  ],
};

describe("same-origin direct AI providers", () => {
  it("posts planner input to the same-origin boundary without a browser secret", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => Response.json({
      result: {
        status: "EXECUTABLE",
        planId: "plan-server",
        turnId: "turn-1",
        sceneRevision: 7,
        normalizedIntent: "다음 페이지",
        relation: "NEW",
        command: {
          capability: "navigation",
          operation: "next_page",
          target: { kind: "CURRENT_PAGE" },
          payload: {},
        },
      },
    }));
    const provider = new HttpDirectCommandPlannerProvider({ fetch: fetchMock });

    await expect(provider.plan(PLANNER_INPUT)).resolves.toMatchObject({
      status: "EXECUTABLE",
      command: { operation: "next_page" },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/voice/direct-command/planner");
    const body = String(init?.body);
    expect(body).toContain("rawFinalTranscript");
    expect(body).not.toContain("OPENAI_API_KEY");
    expect(body).not.toContain("DIRECT_COMMAND_MODEL");
  });

  it("maps selected labels and normalized server errors", async () => {
    const selectedProvider = new HttpDirectTargetDisambiguatorProvider({
      fetch: async () => Response.json({
        result: { status: "SELECTED", candidateLabel: "C2" },
      }),
    });
    await expect(selectedProvider.disambiguate(DISAMBIGUATION_INPUT))
      .resolves.toEqual({ status: "SELECTED", candidateLabel: "C2" });

    const timeoutProvider = new HttpDirectTargetDisambiguatorProvider({
      fetch: async () => Response.json({
        error: { code: "PLANNER_TIMEOUT", reason: "TIMEOUT" },
      }, { status: 504 }),
    });
    await expect(timeoutProvider.disambiguate(DISAMBIGUATION_INPUT))
      .rejects.toMatchObject({
        code: "PLANNER_TIMEOUT",
        reason: "TIMEOUT",
      });
  });

  it("does not call fetch for a pre-aborted request", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => Response.json({ result: {} }));
    const provider = new HttpDirectCommandPlannerProvider({ fetch: fetchMock });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.plan(PLANNER_INPUT, {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not promote a response body that completes after in-flight abort", async () => {
    let resolveBody: ((value: unknown) => void) | undefined;
    const response = {
      ok: true,
      status: 200,
      json: () => new Promise<unknown>((resolve) => {
        resolveBody = resolve;
      }),
    } as Response;
    const provider = new HttpDirectCommandPlannerProvider({
      fetch: async () => response,
    });
    const controller = new AbortController();
    const pending = provider.plan(PLANNER_INPUT, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    resolveBody?.({
      result: {
        status: "CANCELLED",
        turnId: "turn-1",
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});

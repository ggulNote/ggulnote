import { describe, expect, it, vi } from "vitest";
import {
  DirectAiProviderError,
  type MultimodalPlacementRequest,
} from "../domain";
import type { DirectMultimodalModelTransport } from "./direct-multimodal-model-transport";
import { HttpMultimodalPlacementJudgeProvider } from "./http-multimodal-placement-judge-provider";
import { LlmMultimodalPlacementJudgeProvider } from "./llm-multimodal-placement-judge-provider";

const IMAGE = "data:image/png;base64,AA==";

function request(): MultimodalPlacementRequest {
  return {
    observationId: "observation-1",
    pageId: "page-1",
    sceneRevision: 7,
    instruction: "이 그림 아래에 메모 추가",
    draft: { kind: "NOTE", contentSummary: "short note" },
    anchor: { kind: "OBJECT", semanticRole: "FIGURE", textSummary: "diagram" },
    candidates: [
      {
        alias: "S1",
        relation: "BELOW",
        alignment: "START",
        fit: "PREFERRED",
        strategy: "ANCHOR_RELATIVE",
        clearance: "HIGH",
        softOverlap: "NONE",
        regionMatch: true,
      },
      {
        alias: "S2",
        relation: "BELOW",
        alignment: "CENTER",
        fit: "PREFERRED",
        strategy: "ANCHOR_RELATIVE",
        clearance: "MEDIUM",
        softOverlap: "LOW",
        regionMatch: true,
      },
    ],
    images: { globalOverview: IMAGE, localCandidateCrop: IMAGE },
  };
}

describe("LlmMultimodalPlacementJudgeProvider", () => {
  it("sends exactly two images and accepts a current alias", async () => {
    const generate = vi.fn<DirectMultimodalModelTransport["generate"]>()
      .mockResolvedValue('{"choice":"S2"}');
    const provider = new LlmMultimodalPlacementJudgeProvider({ generate });
    await expect(provider.judge(request())).resolves.toEqual({ choice: "S2" });
    expect(generate).toHaveBeenCalledTimes(1);
    const modelRequest = generate.mock.calls[0]?.[0];
    expect(modelRequest?.images).toHaveLength(2);
    expect(modelRequest?.images.map((image) => image.detail)).toEqual(["low", "high"]);
    expect(modelRequest?.allowedChoices).toEqual(["S1", "S2", "NONE"]);
    expect(modelRequest?.instructions).toContain("Do not return coordinates");
  });

  it.each([
    ["NONE", { choice: "NONE" }],
    ["S1", { choice: "S1" }],
  ])("accepts strict %s", async (choice, expected) => {
    const provider = new LlmMultimodalPlacementJudgeProvider({
      generate: async () => JSON.stringify({ choice }),
    });
    await expect(provider.judge(request())).resolves.toEqual(expected);
  });

  it.each([
    '{"choice":"S3"}',
    '{"choice":"S1","reason":"best"}',
    '{"choice":"S1","x":10}',
    '{"choice":"S1","confidence":0.9}',
    "S1 is best",
  ])("rejects non-strict output without retry: %s", async (output) => {
    const generate = vi.fn<DirectMultimodalModelTransport["generate"]>()
      .mockResolvedValue(output);
    const provider = new LlmMultimodalPlacementJudgeProvider({ generate });
    await expect(provider.judge(request())).rejects.toMatchObject({
      code: "PLANNER_INVALID_OUTPUT",
      reason: "INVALID_OUTPUT",
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("normalizes abort without a model call", async () => {
    const generate = vi.fn<DirectMultimodalModelTransport["generate"]>();
    const controller = new AbortController();
    controller.abort();
    const provider = new LlmMultimodalPlacementJudgeProvider({ generate });
    await expect(provider.judge(request(), { signal: controller.signal }))
      .rejects.toMatchObject({ code: "ABORTED" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("HttpMultimodalPlacementJudgeProvider", () => {
  it("uses the same-origin route and validates the returned alias", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("/api/voice/direct-command/placement-judge");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { input: MultimodalPlacementRequest };
      expect(body.input.images.globalOverview).toBe(IMAGE);
      return Response.json({ result: { choice: "S2" } });
    });
    const provider = new HttpMultimodalPlacementJudgeProvider({ fetch: fetchMock });
    await expect(provider.judge(request())).resolves.toEqual({ choice: "S2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes unavailable and invalid route responses", async () => {
    const unavailable = new HttpMultimodalPlacementJudgeProvider({
      fetch: async () => Response.json({
        error: { code: "PLANNER_UNAVAILABLE", reason: "MISSING_CONFIGURATION" },
      }, { status: 503 }),
    });
    await expect(unavailable.judge(request())).rejects.toMatchObject({
      code: "PLANNER_UNAVAILABLE",
      reason: "MISSING_CONFIGURATION",
    });

    const invalid = new HttpMultimodalPlacementJudgeProvider({
      fetch: async () => Response.json({ result: { choice: "S4" } }),
    });
    await expect(invalid.judge(request())).rejects.toBeInstanceOf(DirectAiProviderError);
  });
});

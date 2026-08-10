import { describe, expect, it } from "vitest";
import type { DirectTargetDisambiguationInput } from "../domain";
import { LlmDirectTargetDisambiguatorProvider } from "./llm-direct-target-disambiguator-provider";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
} from "./direct-text-model-transport";

const INPUT: DirectTargetDisambiguationInput = {
  turnId: "turn-1",
  rawFinalTranscript: "AI 문제점을 설명하는 문장 하이라이트",
  normalizedIntent: "AI 문제점 설명 문장 하이라이트",
  targetQuery: {
    kind: "semantic_unit",
    unit: "sentence",
    query: "AI 문제점을 설명",
  },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "selection",
  },
  candidates: [
    {
      label: "C1",
      source: "pdf",
      type: "sentence",
      text: "AI models can reproduce bias present in training data.",
      semanticUnit: "sentence",
    },
    {
      label: "C2",
      source: "pdf",
      type: "sentence",
      text: "AI systems consume large computational resources.",
      semanticUnit: "sentence",
    },
  ],
};

class StubTransport implements DirectTextModelTransport {
  public calls: DirectTextModelRequest[] = [];

  public constructor(public output: string) {}

  public async generate(request: DirectTextModelRequest): Promise<string> {
    this.calls.push(request);
    return this.output;
  }
}

describe("LlmDirectTargetDisambiguatorProvider", () => {
  it("selects only a supplied label and exposes no internal IDs", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "SELECTED",
      candidateLabel: "C1",
    }));
    const provider = new LlmDirectTargetDisambiguatorProvider(transport);

    await expect(provider.disambiguate(INPUT)).resolves.toEqual({
      status: "SELECTED",
      candidateLabel: "C1",
    });
    const request = transport.calls[0];
    expect(request.instructions).toContain("bounded text-only target selector");
    expect(request.instructions).toContain("Never create a candidate");
    expect(JSON.stringify(request)).not.toContain("candidateId");
    expect(JSON.stringify(request)).not.toContain("objectId");
    expect(request.input).toHaveLength(2);
  });

  it("accepts NONE without creating a fallback target", async () => {
    const provider = new LlmDirectTargetDisambiguatorProvider(
      new StubTransport(JSON.stringify({ status: "NONE" })),
    );
    await expect(provider.disambiguate(INPUT)).resolves.toEqual({
      status: "NONE",
    });
  });

  it.each([
    JSON.stringify({ status: "SELECTED", candidateLabel: "C4" }),
    JSON.stringify({
      status: "SELECTED",
      candidateLabel: "C1",
      objectId: "object-123",
    }),
    JSON.stringify({
      status: "SELECTED",
      candidateLabel: "C1",
      operation: "underline",
    }),
    "C1 because it is closest",
  ])("rejects out-of-set or authority-expanding output", async (output) => {
    const provider = new LlmDirectTargetDisambiguatorProvider(
      new StubTransport(output),
    );
    await expect(provider.disambiguate(INPUT)).rejects.toMatchObject({
      code: "PLANNER_INVALID_OUTPUT",
      reason: "INVALID_OUTPUT",
    });
  });
});

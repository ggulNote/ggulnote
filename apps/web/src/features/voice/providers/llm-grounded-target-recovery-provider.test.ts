import { describe, expect, it, vi } from "vitest";
import {
  DirectAiProviderError,
  type GroundedTargetRecoveryInput,
} from "../domain";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
} from "./direct-text-model-transport";
import { LlmGroundedTargetRecoveryProvider } from "./llm-grounded-target-recovery-provider";

const INPUT: GroundedTargetRecoveryInput = {
  kind: "semantic_unit",
  turnId: "turn-1",
  rawFinalTranscript: "헨타이어 프로세스 들어간 문장 하이라이트",
  normalizedIntent: "entire process 문장 하이라이트",
  targetQuery: {
    kind: "semantic_unit",
    unit: "sentence",
    query: "헨타이어 프로세스 들어간",
  },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "page",
  },
  speechEvidence: {
    termHypotheses: [{ rawSpan: "헨타이어", candidates: ["entire"] }],
    numberHypotheses: [],
    contextualTerms: ["entire"],
    asrAlternatives: [],
  },
  candidates: [
    { label: "C1", source: "pdf", type: "sentence", text: "Training starts." },
    { label: "C2", source: "pdf", type: "sentence", text: "The entire process." },
  ],
};

class StubTransport implements DirectTextModelTransport {
  public readonly calls: DirectTextModelRequest[] = [];

  public constructor(
    public output: string,
    private readonly error?: unknown,
  ) {}

  public async generate(request: DirectTextModelRequest): Promise<string> {
    this.calls.push(request);
    if (this.error !== undefined) throw this.error;
    return this.output;
  }
}

describe("LlmGroundedTargetRecoveryProvider", () => {
  it("selects only a supplied semantic label without exposing internal authority", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "SELECTED",
      candidateLabel: "C2",
    }));
    const provider = new LlmGroundedTargetRecoveryProvider(transport);

    await expect(provider.recover(INPUT)).resolves.toEqual({
      status: "SELECTED",
      candidateLabel: "C2",
    });
    const request = transport.calls[0];
    expect(request.instructions).toContain("Select only labels supplied");
    expect(request.instructions).toContain("ASR errors");
    expect(JSON.stringify(request)).not.toContain("candidateId");
    expect(JSON.stringify(request)).not.toContain("objectId");
    expect(JSON.stringify(request)).not.toContain("sourceObjectId");
  });

  it("accepts NONE and fenced strict JSON", async () => {
    await expect(new LlmGroundedTargetRecoveryProvider(
      new StubTransport('{"status":"NONE"}'),
    ).recover(INPUT)).resolves.toEqual({ status: "NONE" });
    await expect(new LlmGroundedTargetRecoveryProvider(
      new StubTransport('```json\n{"status":"SELECTED","candidateLabel":"C1"}\n```'),
    ).recover(INPUT)).resolves.toEqual({
      status: "SELECTED",
      candidateLabel: "C1",
    });
  });

  it.each([
    '{"status":"SELECTED","candidateLabel":"C3"}',
    '{"status":"SELECTED","candidateLabel":"C1","objectId":"object-1"}',
    '{"status":"SELECTED","candidateLabel":"C1","x":10,"y":20}',
    '{"status":"SELECTED","candidateLabel":"C1","operation":"underline"}',
    "C1 because it is closest",
    "{malformed",
  ])("rejects out-of-set, authority-expanding, prose, or malformed output", async (output) => {
    await expect(new LlmGroundedTargetRecoveryProvider(
      new StubTransport(output),
    ).recover(INPUT)).rejects.toMatchObject({
      code: "PLANNER_INVALID_OUTPUT",
      reason: "INVALID_OUTPUT",
    });
  });

  it("normalizes transport failure, timeout, and abort", async () => {
    await expect(new LlmGroundedTargetRecoveryProvider(
      new StubTransport("", new Error("network")),
    ).recover(INPUT)).rejects.toMatchObject({
      code: "PLANNER_UNAVAILABLE",
      reason: "NETWORK_FAILURE",
    });
    await expect(new LlmGroundedTargetRecoveryProvider(
      new StubTransport("", new DirectAiProviderError("PLANNER_TIMEOUT", "TIMEOUT")),
    ).recover(INPUT)).rejects.toMatchObject({ code: "PLANNER_TIMEOUT" });
    const controller = new AbortController();
    controller.abort();
    const transport = new StubTransport("{}");
    await expect(new LlmGroundedTargetRecoveryProvider(transport).recover(
      INPUT,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "ABORTED" });
    expect(transport.calls).toHaveLength(0);
  });

  it("validates supplied span-pair labels for text spans", async () => {
    const input: GroundedTargetRecoveryInput = {
      ...INPUT,
      kind: "text_span",
      targetQuery: {
        kind: "text_span",
        startAnchor: "모얼오벌",
        endAnchor: "인스탠스",
      },
      pairCandidates: [{
        label: "P1",
        startText: "Moreover",
        endText: "instance",
        preview: "Moreover modern For instance",
        relation: { sameSentence: false, sameParagraph: true, rangeLength: "short" },
      }],
    };
    const transport = new StubTransport(
      '{"status":"SELECTED","pairLabel":"P1"}',
    );
    const provider = new LlmGroundedTargetRecoveryProvider(transport);
    await expect(provider.recover(input)).resolves.toEqual({
      status: "SELECTED",
      pairLabel: "P1",
    });
    const request = transport.calls[0];
    expect(request.instructions).toContain("REQUEST-SPECIFIC OUTPUT CONTRACT: text_span");
    expect(request.instructions).toContain('Allowed pairLabel values: ["P1"]');
    expect(request.instructions).toContain("Never return candidateLabel for text_span");
  });

  it("logs only bounded validation metadata for invalid recovery output", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = new LlmGroundedTargetRecoveryProvider(
      new StubTransport('{"status":"SELECTED","candidateLabel":"C1","objectId":"secret-object"}'),
    );

    await expect(provider.recover(INPUT)).rejects.toMatchObject({
      code: "PLANNER_INVALID_OUTPUT",
      reason: "INVALID_OUTPUT",
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[direct-command-ai] Recovery output validation failure",
      expect.objectContaining({
        kind: "SCHEMA_VALIDATION",
        path: "result.objectId",
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-object");
    consoleError.mockRestore();
  });
});

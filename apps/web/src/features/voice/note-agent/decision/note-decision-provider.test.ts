import { describe, expect, it } from "vitest";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
  DirectTextModelTransportOptions,
} from "../../providers/direct-text-model-transport";
import type { NoteDecisionInput } from "../domain";
import { buildNoteDecisionModelRequest } from "./note-decision-prompt";
import { buildNoteDisambiguationModelRequest } from "./note-disambiguation-prompt";
import { FakeNoteDecisionProvider } from "./note-decision-provider";
import { LlmNoteDecisionProvider } from "./llm-note-decision-provider";

const INPUT: NoteDecisionInput = {
  turn: {
    turnId: "turn-1",
    language: "ko-KR",
    rawFinalTranscript: "오른쪽 위에 가나다라 써 줘",
  },
  frozenContext: {
    documentId: "doc-1",
    pageId: "page-1",
    sceneRevision: 7,
    sceneMode: "pdf",
    focus: { kind: "paragraph", textPreview: "short preview" },
  },
  availableTools: [{
    id: "text.create",
    kind: "MUTATION",
    description: "create text",
    input: { text: "string", destination: "optional Destination" },
  }],
};

class StubTransport implements DirectTextModelTransport {
  public calls: DirectTextModelRequest[] = [];

  public constructor(private readonly output: string) {}

  public generate(
    request: DirectTextModelRequest,
    _options: DirectTextModelTransportOptions = {},
  ): Promise<string> {
    this.calls.push(request);
    return Promise.resolve(this.output);
  }
}

describe("One Note Decision provider", () => {
  it("uses the same provider transport for one alias-only ambiguity choice", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "SELECTED",
      alias: "C2",
    }));
    const provider = new LlmNoteDecisionProvider(transport);
    await expect(provider.disambiguate({
      turnId: "turn-1",
      language: "ko-KR",
      rawFinalTranscript: "두 번째 것",
      stepId: "s1",
      toolId: "text.replace",
      candidates: [{ alias: "C1" }, { alias: "C2", textPreview: "second" }],
    })).resolves.toEqual({ status: "SELECTED", alias: "C2" });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.maxOutputTokens).toBe(80);
    expect(JSON.stringify(transport.calls[0])).not.toContain("objectId");

    const request = buildNoteDisambiguationModelRequest({
      turnId: "turn-1", language: "ko-KR", rawFinalTranscript: "x",
      stepId: "s1", toolId: "text.replace",
      candidates: [{ alias: "C1" }, { alias: "C2" }],
    });
    expect(request.input).toHaveLength(1);
  });
  it("uses one compact schema-only model call and validates the selected tool", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "CALL",
      call: {
        stepId: "s1",
        toolId: "text.create",
        input: {
          text: "가나다라",
          destination: { kind: "PAGE_REGION", region: "TOP_RIGHT" },
        },
      },
    }));
    const result = await new LlmNoteDecisionProvider(transport).decide(INPUT);
    expect(result).toMatchObject({ status: "CALL" });
    expect(transport.calls).toHaveLength(1);
    const request = transport.calls[0];
    expect(request.maxOutputTokens).toBeLessThanOrEqual(900);
    expect(request.input).toHaveLength(4);
    expect(JSON.stringify(request)).not.toContain("fullScene");
  });

  it("rejects unavailable tools and model-invented runtime authority", async () => {
    const unavailable = new StubTransport(JSON.stringify({
      status: "CALL",
      call: { stepId: "s1", toolId: "graph.create", input: {} },
    }));
    await expect(new LlmNoteDecisionProvider(unavailable).decide(INPUT))
      .rejects.toMatchObject({ code: "PLANNER_INVALID_OUTPUT" });

    const inventedId = new StubTransport(JSON.stringify({
      status: "CALL",
      call: {
        stepId: "s1",
        toolId: "text.create",
        input: { text: "x", objectId: "invented" },
      },
    }));
    await expect(new LlmNoteDecisionProvider(inventedId).decide(INPUT))
      .rejects.toMatchObject({ code: "PLANNER_INVALID_OUTPUT" });
  });

  it("supports deterministic fake fixtures and AbortSignal", async () => {
    const fake = new FakeNoteDecisionProvider({ status: "NO_OP" });
    await expect(fake.decide(INPUT)).resolves.toEqual({ status: "NO_OP" });
    expect(fake.callCount).toBe(1);
    const controller = new AbortController();
    controller.abort();
    await expect(fake.decide(INPUT, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fake.callCount).toBe(1);
  });

  it("bounds previews and excludes full scene/history payloads", () => {
    const request = buildNoteDecisionModelRequest({
      ...INPUT,
      frozenContext: {
        ...INPUT.frozenContext,
        focus: { textPreview: "a".repeat(1_000) },
      },
    });
    const serialized = JSON.stringify(request.input);
    expect(serialized).not.toContain("a".repeat(241));
    expect(serialized).not.toContain("objectById");
  });
});

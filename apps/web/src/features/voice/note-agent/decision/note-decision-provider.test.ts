import { describe, expect, it, vi } from "vitest";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
  DirectTextModelTransportOptions,
} from "../../providers/direct-text-model-transport";
import type { NoteDecisionInput } from "../domain";
import { buildNoteDecisionModelRequest } from "./note-decision-prompt";
import { buildNoteDisambiguationModelRequest } from "./note-disambiguation-prompt";
import { FakeNoteDecisionProvider } from "./note-decision-provider";
import { HttpNoteDecisionProvider } from "./http-note-decision-provider";
import { LlmNoteDecisionProvider } from "./llm-note-decision-provider";

const INPUT: NoteDecisionInput = {
  turn: {
    turnId: "turn-1",
    language: "ko-KR",
    rawFinalTranscript: "안녕하세요 밑에 가나다라라고 써 줘",
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
    strictArgs: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  }],
  objectCatalog: {
    objects: [{
      handle: "O1",
      source: "tldraw",
      kind: "text",
      summary: "안녕하세요",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      capabilities: ["editable"],
      selected: false,
      focused: false,
      recent: true,
    }],
    truncated: false,
  },
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
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "가나다라" },
        destination: {
          relation: "BELOW",
          anchor: { object: "O1", part: null },
          region: null,
        },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    }));
    const result = await new LlmNoteDecisionProvider(transport).decide(INPUT);
    expect(result).toMatchObject({
      status: "READY",
      steps: [{
        action: "text.create",
        args: { text: "가나다라" },
        destination: {
          relation: "BELOW",
          anchor: { object: "O1" },
        },
      }],
    });
    expect(transport.calls).toHaveLength(1);
    const request = transport.calls[0];
    expect(request.maxOutputTokens).toBeLessThanOrEqual(700);
    expect(request.input).toHaveLength(5);
    expect(request.responseFormat).toMatchObject({
      type: "json_schema",
      name: "note_decision",
      strict: true,
    });
    expect(request.responseFormat?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    const messageContent = request.input.map((message) => message.content).join("\n");
    const serialized = JSON.stringify(request);
    expect(messageContent).toContain('"section":"OBJECT_CATALOG"');
    expect(messageContent).toContain('"section":"USER_UTTERANCE"');
    expect(messageContent).toContain("안녕하세요 밑에 가나다라라고 써 줘");
    expect(messageContent).toContain('"handle":"O1"');
    expect(messageContent).toContain("안녕하세요");
    expect(serialized).not.toContain("fullScene");
    expect(serialized).not.toContain("shape:persistent");
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
    expect(serialized).not.toContain("doc-1");
    expect(serialized).not.toContain("page-1");
  });

  it("forwards only validated numeric transport telemetry across same-origin HTTP", async () => {
    const onTelemetry = vi.fn();
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => Response.json({
      result: { status: "NO_OP" },
      telemetry: {
        openaiTtfbMs: 12,
        openaiBodyReadMs: 3,
        decisionJsonParseMs: 1,
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 20,
      },
    }));
    const provider = new HttpNoteDecisionProvider({ fetch });

    await expect(provider.decide(INPUT, { onTelemetry })).resolves.toEqual({ status: "NO_OP" });
    expect(onTelemetry).toHaveBeenCalledWith({
      openaiTtfbMs: 12,
      openaiBodyReadMs: 3,
      decisionJsonParseMs: 1,
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 20,
    });
    expect(JSON.stringify(fetch.mock.calls[0]?.[1])).not.toContain("Authorization");
  });
});

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
      text: "안녕하세요",
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

class SequenceTransport implements DirectTextModelTransport {
  public calls: DirectTextModelRequest[] = [];

  public constructor(private readonly outputs: readonly string[]) {}

  public generate(
    request: DirectTextModelRequest,
    _options: DirectTextModelTransportOptions = {},
  ): Promise<string> {
    this.calls.push(request);
    const output = this.outputs[this.calls.length - 1];
    if (output === undefined) return Promise.reject(new Error("unexpected model call"));
    return Promise.resolve(output);
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
    expect(request.instructions).toContain("destination MUST be null");
    expect(request.instructions).toContain("destination MUST NOT be null");
    expect(request.instructions).toContain("destination.anchor null");
    expect(request.instructions).toContain("destination.anchor.part to null");
    expect(request.instructions).toContain("target.part MUST use kind text_range");
    expect(request.instructions).toContain("copied verbatim from the selected target object's text");
    expect(request.instructions).toContain("boundary anchors, NOT the full matched span");
    expect(request.instructions).toContain("smallest canonical exact substring corresponding to A");
    expect(request.instructions).toContain("set the unused index, row, column, and text fields to null");
    expect(request.instructions).toContain("NEVER include Korean range particles");
    expect(request.instructions).toContain("For annotation.apply, destination MUST be null");
    expect(request.instructions).toContain("DO NOT choose an object first from general topic similarity");
    expect(request.instructions).toContain("compare it against the supplied text of ALL catalog objects");
    expect(request.instructions).toContain("explicit content reference, strong object-content evidence");
    const messageContent = request.input.map((message) => message.content).join("\n");
    const serialized = JSON.stringify(request);
    expect(messageContent).toContain('"section":"OBJECT_CATALOG"');
    expect(messageContent).toContain('"section":"USER_UTTERANCE"');
    expect(messageContent).toContain("안녕하세요 밑에 가나다라라고 써 줘");
    expect(messageContent).toContain('"handle":"O1"');
    expect(messageContent).toContain("안녕하세요");
    const availableActions = request.input.find((message) =>
      message.content.includes('"section":"AVAILABLE_ACTIONS"'));
    expect(availableActions).toBeDefined();
    expect(JSON.parse(availableActions!.content)).toEqual({
      section: "AVAILABLE_ACTIONS",
      data: [{ id: "text.create", description: "create text" }],
    });
    expect(availableActions!.content.length).toBeLessThan(JSON.stringify(INPUT.availableTools).length);
    expect(availableActions!.content).not.toContain("strictArgs");
    expect(availableActions!.content).not.toContain("examples");
    expect(serialized).not.toContain("fullScene");
    expect(serialized).not.toContain("shape:persistent");
  });

  it("sends full canonical PDF paragraph text instead of a bounded summary", () => {
    const fullText = `${"canonical context ".repeat(14)}rendering HTML into visual webpages. Particularly ...`;
    const request = buildNoteDecisionModelRequest({
      ...INPUT,
      objectCatalog: {
        objects: [{
          ...INPUT.objectCatalog.objects[0]!,
          source: "pdf",
          kind: "paragraph",
          text: fullText,
        }],
        truncated: false,
      },
    });
    const catalogMessage = request.input.find((message) =>
      message.content.includes('"section":"OBJECT_CATALOG"'));
    expect(catalogMessage?.content).toContain(fullText);
    expect(catalogMessage?.content).toContain("rendering HTML into visual webpages");
    expect(catalogMessage?.content).not.toContain('"summary"');
  });

  it("states that canonical span evidence selects its owning PDF object", () => {
    const request = buildNoteDecisionModelRequest({
      ...INPUT,
      turn: {
        ...INPUT.turn,
        rawFinalTranscript: "브랜드 html부터 웹 페이지스까지 하이라이트",
      },
      objectCatalog: {
        objects: [
          {
            ...INPUT.objectCatalog.objects[0]!,
            handle: "O4",
            source: "pdf",
            kind: "paragraph",
            text: "The recent advancement of large language models includes web browsing environments.",
          },
          {
            ...INPUT.objectCatalog.objects[0]!,
            handle: "O12",
            source: "pdf",
            kind: "paragraph",
            text: "However, existing approaches overlook browsing: rendering HTML into visual webpages. Particularly, vision capability is crucial.",
          },
        ],
        truncated: false,
      },
    });
    const catalogMessage = request.input.find((message) =>
      message.content.includes('"section":"OBJECT_CATALOG"'));

    expect(catalogMessage?.content).toContain('"handle":"O4"');
    expect(catalogMessage?.content).toContain('"handle":"O12"');
    expect(catalogMessage?.content).toContain("rendering HTML into visual webpages");
    expect(request.instructions).toContain('object=O12');
    expect(request.instructions).toContain('startText="rendering HTML"');
    expect(request.instructions).toContain('endText="webpages."');
    expect(request.instructions).toContain("annotationType=HIGHLIGHT");
    expect(request.instructions).toContain("Do not choose O4");
    expect(request.instructions).toContain('Correct: startText="rendering HTML", endText="visual webpages."');
    expect(request.instructions).toContain('Wrong: startText="However, existing approaches ... rendering HTML"');
  });

  it("repairs only invalid catalog text-range anchors at most once", async () => {
    const fullText = "However, existing approaches overlook a critical functionality of browsing: rendering HTML into visual webpages. Particularly, vision capability is crucial.";
    const input: NoteDecisionInput = {
      ...INPUT,
      turn: {
        ...INPUT.turn,
        rawFinalTranscript: "렌더링 html부터 웹페이지스까지 밑줄 쳐 줘",
      },
      availableTools: [{
        id: "annotation.apply",
        kind: "MUTATION",
        description: "Apply a partial text annotation with canonical anchors and no destination.",
        strictArgs: {
          type: "object",
          properties: {
            annotationType: { type: "string", enum: ["UNDERLINE", "HIGHLIGHT"] },
            color: { type: ["string", "null"] },
          },
          required: ["annotationType", "color"],
          additionalProperties: false,
        },
      }],
      objectCatalog: {
        objects: [{
          ...INPUT.objectCatalog.objects[0]!,
          handle: "O12",
          source: "pdf",
          kind: "paragraph",
          text: fullText,
        }],
        truncated: false,
      },
    };
    const transport = new StubTransport(JSON.stringify({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "annotation.apply",
        target: {
          object: "O12",
          part: {
            kind: "text_range",
            index: null,
            row: null,
            column: null,
            text: null,
            startText: "rendering HTML",
            endText: "visual webpages",
          },
        },
        args: { annotationType: "UNDERLINE", color: null },
        destination: null,
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    }));

    await expect(new LlmNoteDecisionProvider(transport).decide(input)).resolves.toEqual({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "annotation.apply",
        target: {
          object: "O12",
          part: {
            kind: "text_range",
            index: null,
            row: null,
            column: null,
            text: null,
            startText: "rendering HTML",
            endText: "visual webpages",
          },
        },
        args: { annotationType: "UNDERLINE", color: null },
        destination: null,
      }],
    });
    expect(transport.calls).toHaveLength(1);

    const invalidDecision = JSON.stringify({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "annotation.apply",
        target: {
          object: "O12",
          part: {
            kind: "text_range",
            index: null,
            row: null,
            column: null,
            text: null,
            startText: "렌더링 HTML",
            endText: "웹페이지스까지",
          },
        },
        args: { annotationType: "UNDERLINE", color: null },
        destination: null,
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    });
    const repairedAnchors = JSON.stringify({
      startText: "rendering HTML",
      endText: "visual webpages",
    });
    const repairTransport = new SequenceTransport([invalidDecision, repairedAnchors]);

    await expect(new LlmNoteDecisionProvider(repairTransport).decide(input)).resolves.toEqual({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "annotation.apply",
        target: {
          object: "O12",
          part: {
            kind: "text_range",
            index: null,
            row: null,
            column: null,
            text: null,
            startText: "rendering HTML",
            endText: "visual webpages",
          },
        },
        args: { annotationType: "UNDERLINE", color: null },
        destination: null,
      }],
    });
    expect(repairTransport.calls).toHaveLength(2);
    expect(repairTransport.calls[1]).toMatchObject({
      maxOutputTokens: 100,
      responseFormat: {
        name: "note_text_range_repair",
        strict: true,
      },
    });
    const repairPayload = JSON.parse(repairTransport.calls[1]!.input[0]!.content);
    expect(repairPayload).toEqual({
      originalUserTranscript: "렌더링 html부터 웹페이지스까지 밑줄 쳐 줘",
      selectedObject: {
        handle: "O12",
        text: fullText,
      },
      invalidPreviousAnchors: {
        startText: "렌더링 HTML",
        endText: "웹페이지스까지",
      },
    });
    expect(JSON.stringify(repairTransport.calls[1])).not.toContain("objectCatalog");

    const failedRepairTransport = new SequenceTransport([
      invalidDecision,
      JSON.stringify({
        startText: "still invalid",
        endText: "also invalid",
      }),
    ]);
    await expect(new LlmNoteDecisionProvider(failedRepairTransport).decide(input))
      .rejects.toMatchObject({ code: "PLANNER_INVALID_OUTPUT" });
    expect(failedRepairTransport.calls).toHaveLength(2);
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

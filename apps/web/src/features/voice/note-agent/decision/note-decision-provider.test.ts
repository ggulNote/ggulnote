import { describe, expect, it, vi } from "vitest";
import { connectedMathActionDecisionArgsSchema } from "@ggulnote/math-core";
import type {
  DirectTextModelContentPart,
  DirectTextModelRequest,
  DirectTextModelTransport,
  DirectTextModelTransportOptions,
} from "../../providers/direct-text-model-transport";
import type { NoteDecisionInput } from "../domain";
import { buildNoteDecisionModelRequest } from "./note-decision-prompt";
import { FakeNoteDecisionProvider } from "./note-decision-provider";
import { HttpNoteDecisionProvider } from "./http-note-decision-provider";
import { LlmNoteDecisionProvider } from "./llm-note-decision-provider";

function readTextContent(
  content: string | readonly DirectTextModelContentPart[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<DirectTextModelContentPart, { type: "input_text" }> =>
      part.type === "input_text")
    .map((part) => part.text)
    .join("\n");
}

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
  pageBase: {
    documentId: "doc-1",
    pageId: "page-1",
    baseRevision: "page-1@1",
    sceneMode: "pdf",
    objects: [{
      handle: "O1",
      source: "tldraw",
      kind: "text",
      text: "안녕하세요",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      capabilities: ["editable"],
      selected: false,
      focused: false,
      recent: false,
    }],
    createdAt: 1,
  },
  liveScene: {
    sceneRevision: 7,
    createdObjects: [],
    updatedObjects: [],
    deletedObjectIds: [],
    selectedObjectIds: [],
    recentObjectIds: ["O1"],
  },
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

describe("One Note Decision provider", () => {
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
    expect(request.input).toHaveLength(4);
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
    expect(request.instructions).toContain("Interpret intent instead of copying the transcript");
    expect(request.instructions).toContain('args.source="x^2+1"');
    expect(request.instructions).toContain("math.graph.add_tangent");
    expect(request.instructions).toContain("computes the exact derivative and tangent");
    expect(request.instructions).toContain("only visual pass");
    expect(request.instructions).toContain("VISUAL_UNRESOLVED");
    expect(request.instructions).not.toContain("Use NEEDS_VISUAL");
    const messageContent = request.input.map((message) => readTextContent(message.content)).join("\n");
    const serialized = JSON.stringify(request);
    expect(messageContent).toContain('"section":"PAGE_BASE"');
    expect(messageContent).toContain('"section":"LIVE_SCENE"');
    expect(messageContent).toContain('"section":"VOICE_COMMAND"');
    expect(messageContent).toContain("안녕하세요 밑에 가나다라라고 써 줘");
    expect(messageContent).toContain('"handle":"O1"');
    expect(messageContent).toContain("안녕하세요");
    const availableActions = request.input.find((message) =>
      readTextContent(message.content).includes('"section":"STATIC_CONTEXT"'));
    expect(availableActions).toBeDefined();
    const availableActionsContent = readTextContent(availableActions!.content);
    expect(JSON.parse(availableActionsContent)).toEqual({
      section: "STATIC_CONTEXT",
      data: {
        contextOrder: ["STATIC", "PAGE_BASE", "LIVE", "SCREENSHOT", "COMMAND"],
        availableActions: [{
          kind: "MUTATION",
          id: "text.create",
          description: "create text",
        }],
      },
    });
    expect(availableActionsContent).not.toContain("strictArgs");
    expect(availableActionsContent).not.toContain("examples");
    expect(serialized).not.toContain("fullScene");
    expect(serialized).not.toContain("shape:persistent");
    expect(request.input.map((message) =>
      JSON.parse(readTextContent(message.content)).section)).toEqual([
      "STATIC_CONTEXT",
      "PAGE_BASE",
      "LIVE_SCENE",
      "VOICE_COMMAND",
    ]);
  });

  it("sends Object Catalog and a complex-scene screenshot in the same Decision call", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "풀이" },
        destination: {
          relation: "CANVAS_REGION",
          anchor: null,
          region: "BOTTOM_RIGHT",
        },
      }],
      reason: null,
    }));
    const input: NoteDecisionInput = {
      ...INPUT,
      visualContext: {
        mimeType: "image/png",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        pixelWidth: 960,
        pixelHeight: 1_280,
        byteLength: 8,
        markedObjects: [{
          objectId: "O1",
          kind: INPUT.objectCatalog.objects[0]!.kind,
          bounds: INPUT.objectCatalog.objects[0]!.bounds,
        }],
      },
    };

    await expect(new LlmNoteDecisionProvider(transport).decide(input))
      .resolves.toMatchObject({ status: "READY" });

    expect(transport.calls).toHaveLength(1);
    const request = transport.calls[0]!;
    expect(request.input).toHaveLength(5);
    expect(request.input.some((message) =>
      readTextContent(message.content).includes('"section":"PAGE_BASE"'))).toBe(true);
    const visual = request.input.at(-2)?.content;
    expect(Array.isArray(visual)).toBe(true);
    expect(visual).toEqual([
      {
        type: "input_text",
        text: JSON.stringify({
          section: "CURRENT_CANVAS_IMAGE",
          data: {
            purpose: "marked visual meaning and layout evidence",
            markerCoordinateSpace: "page-normalized",
            markedObjects: input.visualContext?.markedObjects,
            pixelWidth: 960,
            pixelHeight: 1_280,
          },
        }),
      },
      {
        type: "input_image",
        image_url: input.visualContext?.imageDataUrl,
        detail: "high",
      },
    ]);
    expect(request.instructions).toContain("exact same ObjectHandle O7");
    expect(request.instructions).toContain("Do not invent object handles or pixel coordinates");
    expect(readTextContent(request.input.at(-1)!.content)).toContain('"section":"VOICE_COMMAND"');
  });

  it("accepts semantic tangent x/y fields without treating them as pixel authority", async () => {
    const transport = new StubTransport(JSON.stringify({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "math.graph.add_tangent",
        target: { object: "O1", part: null },
        args: {
          mode: "auto",
          x: null,
          y: null,
          quadrant: null,
          label: null,
        },
        destination: null,
      }],
      reason: null,
    }));
    const tangentInput: NoteDecisionInput = {
      ...INPUT,
      turn: { ...INPUT.turn, rawFinalTranscript: "그래프에 접선 그어줘" },
      availableTools: [{
        id: "math.graph.add_tangent",
        kind: "MUTATION",
        description: "Add a tangent; runtime computes exact geometry.",
        strictArgs: connectedMathActionDecisionArgsSchema("math.graph.add_tangent"),
      }],
      objectCatalog: {
        objects: [{
          handle: "O1",
          source: "tldraw",
          kind: "graph",
          summary: "y=x^2 graph",
          bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
          capabilities: ["mathTangentAddable"],
          selected: false,
          focused: false,
          recent: true,
        }],
        truncated: false,
      },
    };

    await expect(new LlmNoteDecisionProvider(transport).decide(tangentInput))
      .resolves.toMatchObject({
        status: "READY",
        steps: [{
          action: "math.graph.add_tangent",
          args: { mode: "auto", x: null, y: null, quadrant: null },
        }],
      });
    expect(transport.calls).toHaveLength(1);
  });

  it("sends full canonical PDF paragraph text instead of a bounded summary", () => {
    const fullText = `${"canonical context ".repeat(14)}rendering HTML into visual webpages. Particularly ...`;
    const request = buildNoteDecisionModelRequest({
      ...INPUT,
      pageBase: {
        ...INPUT.pageBase,
        objects: [{
          ...INPUT.pageBase.objects[0]!,
          source: "pdf",
          kind: "paragraph",
          text: fullText,
        }],
        pageText: fullText,
      },
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
      readTextContent(message.content).includes('"section":"PAGE_BASE"'));
    const catalogContent = readTextContent(catalogMessage!.content);
    expect(catalogContent).toContain(fullText);
    expect(catalogContent).toContain("rendering HTML into visual webpages");
    expect(catalogContent).not.toContain('"summary"');
  });

  it("states that canonical span evidence selects its owning PDF object", () => {
    const request = buildNoteDecisionModelRequest({
      ...INPUT,
      turn: {
        ...INPUT.turn,
        rawFinalTranscript: "브랜드 html부터 웹 페이지스까지 하이라이트",
      },
      pageBase: {
        ...INPUT.pageBase,
        objects: [
          {
            ...INPUT.pageBase.objects[0]!,
            handle: "O4",
            source: "pdf",
            kind: "paragraph",
            text: "The recent advancement of large language models includes web browsing environments.",
          },
          {
            ...INPUT.pageBase.objects[0]!,
            handle: "O12",
            source: "pdf",
            kind: "paragraph",
            text: "However, existing approaches overlook browsing: rendering HTML into visual webpages. Particularly, vision capability is crucial.",
          },
        ],
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
      readTextContent(message.content).includes('"section":"PAGE_BASE"'));

    const catalogContent = readTextContent(catalogMessage!.content);

    expect(catalogContent).toContain('"handle":"O4"');
    expect(catalogContent).toContain('"handle":"O12"');
    expect(catalogContent).toContain("rendering HTML into visual webpages");
    expect(request.instructions).toContain('object=O12');
    expect(request.instructions).toContain('startText="rendering HTML"');
    expect(request.instructions).toContain('endText="webpages."');
    expect(request.instructions).toContain("annotationType=HIGHLIGHT");
    expect(request.instructions).toContain("Do not choose O4");
    expect(request.instructions).toContain('Correct: startText="rendering HTML", endText="visual webpages."');
    expect(request.instructions).toContain('Wrong: startText="However, existing approaches ... rendering HTML"');
  });

  it("accepts exact text-range anchors and rejects invalid anchors after one call", async () => {
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
      reason: null,
    });
    const invalidTransport = new StubTransport(invalidDecision);
    await expect(new LlmNoteDecisionProvider(invalidTransport).decide(input))
      .rejects.toMatchObject({ code: "PLANNER_INVALID_OUTPUT" });
    expect(invalidTransport.calls).toHaveLength(1);
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
    expect(serialized).toContain("doc-1");
    expect(serialized).toContain("page-1");
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

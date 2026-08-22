import { describe, expect, it } from "vitest";
import {
  NOTE_SPATIAL_RELATIONS,
  NoteAgentValidationError,
  parseDestination,
  parseEntitySelector,
  parseNoteDecision,
  parseNoteDecisionInput,
} from "./index";

describe("EntitySelector strict schema", () => {
  it("accepts declarative object part criteria but rejects a supplied partId", () => {
    expect(parseEntitySelector({
      kinds: ["table"],
      part: { kind: "cell", row: 2, column: 3 },
    })).toMatchObject({ part: { kind: "cell", row: 2, column: 3 } });
    expect(() => parseEntitySelector({
      kinds: ["table"],
      part: { kind: "cell", partId: "invented" },
    })).toThrowError(/partId|runtime authority/u);
  });
  it("keeps every unspoken constraint optional", () => {
    expect(parseEntitySelector({})).toEqual({});
    expect(parseEntitySelector({
      scope: "DOCUMENT",
      kinds: ["graph"],
      source: "USER_CREATED",
      content: { text: "안녕하세요", math: "x^2", semantic: "이차함수" },
      attributes: { degree: 2, selected: true },
      temporal: "FIRST_CREATED",
      ordinal: 2,
    })).toMatchObject({ kinds: ["graph"], ordinal: 2 });
  });

  it.each([
    ["objectId", "invented"],
    ["candidateId", "C1"],
    ["rangeId", "range-1"],
    ["partId", "curve-1"],
    ["x", 10],
    ["bounds", { x: 1, y: 2, width: 3, height: 4 }],
    ["offset", 4],
  ])("rejects forbidden runtime authority field %s at any depth", (field, value) => {
    expect(() => parseEntitySelector({
      kinds: ["graph"],
      attributes: { nested: { [field]: value } },
    })).toThrowError(/runtime authority field is forbidden/u);
  });

  it("rejects unknown fields, malformed records, and prototype-bearing input", () => {
    expect(() => parseEntitySelector({ query: "hello" })).toThrowError(/unexpected field/u);
    expect(() => parseEntitySelector([])).toThrowError(/expected an object/u);
    expect(() => parseEntitySelector(Object.create({ kinds: ["text"] })))
      .toThrowError(/expected a plain object/u);
  });

  it("allows selector nesting through depth 2 and rejects depth 3", () => {
    const selectorAtDepth = (depth: number): unknown => depth === 0
      ? { kinds: ["graph"] }
      : {
          kinds: ["math"],
          spatial: [{
            relation: "BELOW",
            reference: { kind: "ENTITY", selector: selectorAtDepth(depth - 1) },
          }],
        };
    expect(parseEntitySelector(selectorAtDepth(2))).toBeDefined();
    expect(() => parseEntitySelector(selectorAtDepth(3))).toThrowError(
      /selector nesting exceeds depth 2/u,
    );
  });

  it("accepts the complete shared spatial language", () => {
    for (const relation of NOTE_SPATIAL_RELATIONS) {
      const result = parseEntitySelector({
        kinds: ["math"],
        spatial: [{ relation, reference: { kind: "FOCUS" } }],
      });
      expect(result.spatial?.[0]?.relation).toBe(relation);
    }
  });
});

describe("Destination strict schema", () => {
  it("accepts optional page and relative destinations", () => {
    expect(parseDestination({
      kind: "PAGE_REGION",
      region: "TOP_RIGHT",
      alignment: "END",
      avoidOverlap: true,
    })).toMatchObject({ kind: "PAGE_REGION", region: "TOP_RIGHT" });
    expect(parseDestination({
      kind: "RELATIVE",
      relation: "BESIDE",
      anchor: { kinds: ["text"], source: "USER_CREATED" },
      distance: "NEAR",
    })).toMatchObject({ kind: "RELATIVE", relation: "BESIDE" });
  });

  it("rejects coordinates and unknown fields", () => {
    expect(() => parseDestination({
      kind: "PAGE_REGION",
      region: "TOP_RIGHT",
      x: 20,
    })).toThrowError(/runtime authority field is forbidden/u);
    expect(() => parseDestination({
      kind: "PAGE_REGION",
      region: "TOP_RIGHT",
      strategy: "invented",
    })).toThrowError(/unexpected field/u);
  });
});

describe("One Note Decision strict schema", () => {
  it("accepts only normalized object regions and explicit fallback coordinate spaces", () => {
    const decision = parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: {
          object: "O7",
          part: null,
          region: { x: 0.6, y: 0.65, width: 0.16, height: 0.14 },
          fallbackPoint: { x: 0.7, y: 0.7, coordinateSpace: "PAGE" },
        },
        args: { text: "중요" },
        placement: { x: 0.6, y: 0.65, width: null, height: null },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    });
    expect(decision).toMatchObject({
      status: "READY",
      steps: [{
        target: {
          object: "O7",
          region: { x: 0.6, y: 0.65, width: 0.16, height: 0.14 },
          fallbackPoint: { coordinateSpace: "PAGE" },
        },
      }],
    });
    expect(() => parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: {
          object: "O7",
          part: null,
          region: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 },
          fallbackPoint: null,
        },
        args: { text: "invalid" },
        placement: { x: 0.1, y: 0.1, width: null, height: null },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    })).toThrowError(/inside the target object/u);
    expect(() => parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: {
          object: null,
          part: null,
          region: null,
          fallbackPoint: { x: 0.5, y: 0.5, coordinateSpace: "OBJECT_LOCAL" },
        },
        args: { text: "invalid" },
        placement: { x: 0.1, y: 0.1, width: null, height: null },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    })).toThrowError(/OBJECT_LOCAL requires an object handle/u);
  });

  it("allows graph-domain tangent x only inside typed tangent args", () => {
    const tangent = {
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "math.graph.add_tangent",
        target: { object: "O1", part: null },
        args: { at: { x: -1 }, label: null },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    };

    expect(parseNoteDecision(tangent)).toMatchObject({
      status: "READY",
      steps: [{
        action: "math.graph.add_tangent",
        args: { at: { x: -1 } },
      }],
    });
    expect(() => parseNoteDecision({
      ...tangent,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "hello", x: 20 },
        placement: { x: 0.1, y: 0.1, width: null, height: null },
      }],
    })).toThrowError(/runtime authority field is forbidden/u);
    expect(() => parseNoteDecision({
      ...tangent,
      steps: [{
        ...tangent.steps[0],
        args: { ...tangent.steps[0].args, objectId: "invented" },
      }],
    })).toThrowError(/runtime authority field is forbidden/u);
  });

  it.each([
    {
      status: "CALL",
      call: { stepId: "s1", toolId: "text.create", input: { text: "가나다라" } },
    },
    {
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "math.multiply", input: {} },
        { stepId: "s2", toolId: "text.create", input: { text: "result" } },
      ],
    },
    { status: "NEEDS_INPUT", missing: ["target"] },
    { status: "UNSUPPORTED", reasonCode: "TOOL_NOT_AVAILABLE" },
    { status: "NO_OP" },
  ])("accepts $status", (decision) => {
    expect(parseNoteDecision(decision)).toEqual(decision);
  });

  it("rejects non-atomic, duplicate, oversized, and authority-bearing calls", () => {
    expect(() => parseNoteDecision({ status: "BATCH", atomic: false, steps: [] }))
      .toThrowError(/atomic true/u);
    expect(() => parseNoteDecision({
      status: "BATCH",
      atomic: true,
      steps: Array.from({ length: 5 }, (_, index) => ({
        stepId: `s${index}`,
        toolId: "text.create",
        input: {},
      })),
    })).toThrowError(/between 1 and 4/u);
    expect(() => parseNoteDecision({
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "text.create", input: {} },
        { stepId: "s1", toolId: "history.undo", input: {} },
      ],
    })).toThrowError(/stepId values must be unique/u);
    expect(() => parseNoteDecision({
      status: "CALL",
      call: { stepId: "s1", toolId: "text.create", input: { objectId: "fake" } },
    })).toThrowError(NoteAgentValidationError);
  });

  it("allows only backward step-output references in an atomic batch", () => {
    const decision = {
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "math.add", input: { values: [1, 2] } },
        {
          stepId: "s2",
          toolId: "text.create",
          input: { text: { fromStep: "s1", path: ["sum"] } },
        },
      ],
    };
    expect(parseNoteDecision(decision)).toEqual(decision);
    expect(() => parseNoteDecision({
      status: "BATCH",
      atomic: true,
      steps: [
        {
          stepId: "s1",
          toolId: "text.create",
          input: { text: { fromStep: "s2" } },
        },
        { stepId: "s2", toolId: "math.add", input: { values: [1, 2] } },
      ],
    })).toThrowError(/earlier step/u);
    expect(() => parseNoteDecision({
      status: "CALL",
      call: {
        stepId: "s1",
        toolId: "text.create",
        input: { text: { fromStep: "s1" } },
      },
    })).toThrowError(/earlier step/u);
  });

  it("strictly parses compact decision input", () => {
    const input = {
      turn: { turnId: "turn-1", language: "ko-KR", rawFinalTranscript: "써 줘" },
      frozenContext: {
        documentId: "doc-1",
        pageId: "page-1",
        sceneRevision: 7,
        sceneMode: "pdf",
        selection: { kind: "text", textPreview: "hello" },
        focus: { kind: "paragraph" },
        lastOperation: { toolId: "annotation.apply", outputKind: "annotation" },
      },
      availableTools: [{
        id: "text.create",
        kind: "MUTATION",
        description: "create text",
        input: { text: "string" },
      }],
      pageBase: {
        documentId: "doc-1",
        pageId: "page-1",
        baseRevision: "page-1@1",
        sceneMode: "pdf",
        objects: [],
        pageText: "hello",
        createdAt: 1,
      },
      liveScene: {
        sceneRevision: 7,
        createdObjects: [],
        updatedObjects: [],
        deletedObjectIds: [],
        selectedObjectIds: ["O1"],
        recentObjectIds: ["O1"],
      },
      objectCatalog: {
        objects: [{
          handle: "O1",
          source: "tldraw",
          kind: "text",
          text: "hello",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
          capabilities: ["canRead", "canEditText"],
          selected: true,
          focused: false,
          recent: true,
        }],
        truncated: false,
      },
    };
    expect(parseNoteDecisionInput(input)).toEqual(input);
    const visualInput = {
      ...input,
      visualContext: {
        mimeType: "image/png",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        pixelWidth: 960,
        pixelHeight: 1280,
        byteLength: 8,
        markedObjects: [{
          objectId: "O1",
          kind: "text",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
        }],
      },
    };
    expect(parseNoteDecisionInput(visualInput)).toEqual(visualInput);
    expect(() => parseNoteDecisionInput({
      ...visualInput,
      visualContext: {
        ...visualInput.visualContext,
        mimeType: "image/jpeg",
      },
    })).toThrowError(/matching base64 image data URL/u);
    expect(() => parseNoteDecisionInput({
      ...input,
      objectCatalog: {
        objects: [{ ...input.objectCatalog.objects[0], summary: "duplicate" }],
        truncated: false,
      },
    })).toThrowError(/both text and summary/u);
    expect(() => parseNoteDecisionInput({ ...input, fullScene: [] }))
      .toThrowError(/unexpected field/u);
  });
});

import { describe, expect, it } from "vitest";
import {
  NOTE_SPATIAL_RELATIONS,
  NoteAgentValidationError,
  parseDestination,
  parseEntitySelector,
  parseNoteDecision,
  parseNoteDecisionInput,
  parseNoteDisambiguationChoice,
  parseNoteDisambiguationInput,
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

describe("Note disambiguation strict schema", () => {
  it("bounds candidates and accepts only aliases", () => {
    const input = parseNoteDisambiguationInput({
      turnId: "turn-1",
      language: "ko-KR",
      rawFinalTranscript: "두 번째 것",
      stepId: "s1",
      toolId: "text.replace",
      candidates: [{ alias: "C1" }, { alias: "C2", textPreview: "second" }],
    });
    expect(input.candidates).toHaveLength(2);
    expect(parseNoteDisambiguationChoice({ status: "SELECTED", alias: "C2" }))
      .toEqual({ status: "SELECTED", alias: "C2" });
    expect(() => parseNoteDisambiguationChoice({
      status: "SELECTED",
      alias: "object-1",
    })).toThrowError(/candidate alias/u);
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

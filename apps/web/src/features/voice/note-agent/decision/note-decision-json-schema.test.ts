import { describe, expect, it } from "vitest";
import { parseNoteDecision } from "../domain";
import { buildNoteDecisionJsonSchema } from "./note-decision-json-schema";

describe("One Note Decision Responses strict schema", () => {
  it("uses an object root, nullable status fields, and registry-derived action variants", () => {
    const schema = buildNoteDecisionJsonSchema([
      {
        id: "text.create",
        kind: "MUTATION",
        description: "Create text",
        input: { text: "string" },
        strictArgs: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
      {
        id: "history.undo",
        kind: "MUTATION",
        description: "Undo",
        input: {},
        strictArgs: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ]);
    const root = schema as Record<string, unknown>;
    expect(root.type).toBe("object");
    expect(root.additionalProperties).toBe(false);
    expect(root.required).toEqual([
      "status",
      "sceneRevision",
      "steps",
      "candidateHandles",
      "cropRegion",
      "reason",
    ]);
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"const":"text.create"');
    expect(serialized).toContain('"const":"history.undo"');
    expect(serialized).not.toContain("graph.create");
    expect(serialized).not.toContain("objectId");
    expect(serialized).not.toContain("TLShapeId");
  });

  it("normalizes strict nullable fields without weakening status validation", () => {
    expect(parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "가나다라" },
        destination: {
          relation: "CANVAS_REGION",
          anchor: null,
          region: "TOP_RIGHT",
        },
      }],
      candidateHandles: null,
      cropRegion: null,
      reason: null,
    })).toEqual({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "가나다라" },
        destination: {
          relation: "CANVAS_REGION",
          anchor: null,
          region: "TOP_RIGHT",
        },
      }],
    });
    expect(() => parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [],
      candidateHandles: ["O1", "O2"],
      cropRegion: null,
      reason: null,
    })).toThrow(/candidateHandles/u);
  });
});

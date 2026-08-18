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
      {
        id: "annotation.apply",
        kind: "MUTATION",
        description: "Annotate",
        strictArgs: {
          type: "object",
          properties: {
            annotationType: { type: "string", enum: ["UNDERLINE", "HIGHLIGHT"] },
            color: { type: ["string", "null"] },
          },
          required: ["annotationType", "color"],
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
    expect(serialized).toContain('"const":"annotation.apply"');
    expect(serialized).toContain("canonical non-empty startText/endText");
    expect(serialized).not.toContain("graph.create");
    expect(serialized).not.toContain("objectId");
    expect(serialized).not.toContain("TLShapeId");
    const stepVariants = ((root.properties as Record<string, unknown>).steps as {
      anyOf: readonly [{ items: { anyOf: readonly Record<string, unknown>[] } }, unknown];
    }).anyOf[0].items.anyOf;
    const annotationVariant = stepVariants.find((variant) =>
      ((variant.properties as Record<string, { const?: string }>).action?.const)
        === "annotation.apply");
    expect((annotationVariant?.properties as Record<string, unknown>).destination)
      .toEqual({ type: "null" });
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

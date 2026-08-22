import { describe, expect, it } from "vitest";
import { connectedMathActionDecisionArgsSchema } from "@ggulnote/math-core";
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
      {
        id: "math.graph.create",
        kind: "MUTATION",
        description: "Create graph",
        strictArgs: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
      {
        id: "math.graph.add_tangent",
        kind: "MUTATION",
        description: "Add tangent",
        strictArgs: connectedMathActionDecisionArgsSchema("math.graph.add_tangent"),
      },
    ]);
    const root = schema as Record<string, unknown>;
    expect(root.type).toBe("object");
    expect(root.additionalProperties).toBe(false);
    expect(root.required).toEqual([
      "status",
      "sceneRevision",
      "steps",
      "reason",
    ]);
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain("NEEDS_VISUAL");
    expect(serialized).not.toContain("candidateHandles");
    expect(serialized).not.toContain("cropRegion");
    expect(serialized).toContain('"const":"text.create"');
    expect(serialized).toContain('"const":"history.undo"');
    expect(serialized).toContain('"const":"annotation.apply"');
    expect(serialized).toContain('"const":"math.graph.add_tangent"');
    expect(serialized).not.toContain('"NEAR"');
    expect(serialized).toContain("canonical non-empty startText/endText");
    expect(serialized).toContain('"coordinateSpace"');
    expect(serialized).toContain('"OBJECT_LOCAL"');
    expect(serialized).toContain('"fallbackPoint"');
    expect(serialized).toContain('"exclusiveMinimum":0');
    expect(serialized).not.toContain("math.matrix_multiply");
    expect(serialized).not.toContain("objectId");
    expect(serialized).not.toContain("TLShapeId");
    const stepVariants = ((root.properties as Record<string, unknown>).steps as {
      anyOf: readonly [{ items: { anyOf: readonly Record<string, unknown>[] } }, unknown];
    }).anyOf[0].items.anyOf;
    const annotationVariant = stepVariants.find((variant) =>
      ((variant.properties as Record<string, { const?: string }>).action?.const)
        === "annotation.apply");
    expect((annotationVariant?.properties as Record<string, unknown>).placement)
      .toBeUndefined();
    const graphCreateVariant = stepVariants.find((variant) =>
      ((variant.properties as Record<string, { const?: string }>).action?.const)
        === "math.graph.create");
    expect((graphCreateVariant?.properties as Record<string, unknown>).placement)
      .toHaveProperty("properties");
    const tangentVariant = stepVariants.find((variant) =>
      ((variant.properties as Record<string, { const?: string }>).action?.const)
        === "math.graph.add_tangent");
    expect((tangentVariant?.properties as Record<string, unknown>).placement)
      .toBeUndefined();
    expect((tangentVariant?.properties as Record<string, unknown>).target)
      .not.toHaveProperty("anyOf");
    const tangentArgs = (tangentVariant?.properties as Record<string, unknown>).args as {
      readonly properties: Record<string, unknown>;
      readonly required: readonly string[];
    };
    expect(tangentArgs.required).toEqual(["at", "label"]);
    expect(tangentArgs.properties.at).toHaveProperty("properties.x");
  });

  it("parses the reduced production response without legacy visual-pass fields", () => {
    expect(parseNoteDecision({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "가나다라" },
        placement: { x: 0.75, y: 0.1, width: null, height: null },
      }],
      reason: null,
    })).toEqual({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.create",
        target: null,
        args: { text: "가나다라" },
        placement: { x: 0.75, y: 0.1, width: null, height: null },
      }],
    });
  });
});

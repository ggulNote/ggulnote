import { CONNECTED_MATH_ACTION_IDS } from "@ggulnote/math-core";
import { buildSceneSnapshot } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type { FrozenVoiceTurnContext, PageTargetCatalog } from "../../domain";
import {
  ExistingWorldResolver,
  type FrozenWorldContext,
  type UnifiedObjectWorld,
} from "../world";
import type { NoteToolContext } from "./note-tool-registry";
import { createMathPlacementContract, createMathTools } from "./math-tools";
import { createExistingNoteToolRegistry } from "./existing-tool-adapters";

describe("editor-connected math action tools", () => {
  it("registers exactly the connected math-core actions, including tangent", () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "SHADOW" } as NoteToolContext;
    const mathIds = registry.compactSchemas(context)
      .map((tool) => tool.id)
      .filter((id) => id.startsWith("math."));

    expect(mathIds).toEqual(CONNECTED_MATH_ACTION_IDS);
    expect(mathIds).toContain("math.graph.add_tangent");
    expect(mathIds).toContain("math.shape.create_circle");
    expect(mathIds).not.toContain("math.add");
    expect(mathIds).not.toContain("math.matrix_multiply");
  });

  it("uses math-core Decision schemas and validates the smoke inputs strictly", () => {
    const tools = createMathTools();
    const expression = tools.find((tool) => tool.id === "math.expression.create");
    const graph = tools.find((tool) => tool.id === "math.graph.create");
    const point = tools.find((tool) => tool.id === "math.graph.add_point");
    const tangent = tools.find((tool) => tool.id === "math.graph.add_tangent");
    if (expression === undefined || graph === undefined || point === undefined || tangent === undefined) {
      throw new Error("Expected all connected math tools.");
    }

    expect(expression.inputSchema.parse({ source: "x² + 2x + 1" })).toMatchObject({
      args: { source: "x² + 2x + 1" },
    });
    expect(() => expression.inputSchema.parse({ source: "x", extra: true }))
      .toThrowError(/extra/u);
    expect(graph.inputSchema.parse({
      expression: "y=x²",
      functionType: "quadratic",
      parameters: [
        { name: "a", value: 1 },
        { name: "b", value: 0 },
        { name: "c", value: 0 },
      ],
    })).toMatchObject({ args: { expression: "y=x²", functionType: "quadratic" } });
    expect(point.inputSchema.parse({
      target: { object: "O1", part: null },
      xValue: null,
      yValue: null,
      label: null,
    })).toMatchObject({ target: { object: "O1", part: null } });
    expect(() => point.inputSchema.parse({ xValue: null, yValue: null, label: null }))
      .toThrowError(/target/u);
    expect(tangent.inputSchema.parse({
      target: { object: "O1", part: null },
      mode: "quadrant",
      x: null,
      y: null,
      quadrant: 2,
      label: null,
    })).toMatchObject({
      target: { object: "O1", part: null },
      args: { mode: "quadrant", quadrant: 2 },
    });
    expect(tangent.inputSchema.parse({
      target: {
        object: "O1",
        part: {
          kind: "curve",
          index: null,
          row: null,
          column: null,
          text: null,
          startText: null,
          endText: null,
        },
      },
      mode: "quadrant",
      x: null,
      y: null,
      quadrant: 2,
      label: null,
    })).toMatchObject({
      target: { object: "O1", part: null },
      args: { mode: "quadrant", quadrant: 2 },
    });
    expect(() => tangent.inputSchema.parse({
      target: {
        object: "O1",
        part: {
          kind: "point",
          index: null,
          row: null,
          column: null,
          text: null,
          startText: null,
          endText: null,
        },
      },
      mode: "quadrant",
      x: null,
      y: null,
      quadrant: 2,
      label: null,
    })).toThrowError(/whole math object or its unqualified graph curve/u);
    expect(tangent.inputSchema.parse({
      target: { object: "O1", part: null },
      mode: "auto",
      x: null,
      y: null,
      quadrant: null,
      label: null,
    })).toMatchObject({
      target: { object: "O1", part: null },
      args: { mode: "auto", x: null, y: null, quadrant: null },
    });
    expect(expression.description).toContain("canonical source");
    expect(tangent.description).toContain("exact derivative");
  });

  it("uses one notebook placement profile for every math create action", () => {
    const graph = createMathPlacementContract(
      "math.graph.create",
      "draft-graph",
      { width: 552, height: 752 },
    );
    expect(graph).toMatchObject({
      profile: {
        capability: "graph",
        preferredSize: { width: 360, height: 300 },
        minClearance: 16,
      },
      draft: {
        draftKey: "draft-graph",
        preferredFootprint: { width: 360, height: 300 },
      },
    });
    expect(createMathPlacementContract(
      "math.graph.add_tangent",
      "draft-tangent",
      { width: 552, height: 752 },
    )).toBeUndefined();
  });

  it("passes a resolved object-local region directly to the registered circle action", async () => {
    const shape = createMathTools().find((tool) => tool.id === "math.shape.create_circle");
    if (shape === undefined) throw new Error("Expected circle shape tool.");
    const scene = buildSceneSnapshot({
      mode: "blank",
      page: { id: "page-1", index: 0, width: 600, height: 800 },
      sceneRevision: 7,
    });
    const world: UnifiedObjectWorld = {
      getSnapshot: (pageId, revision) =>
        pageId === "page-1" && revision === 7 ? scene : undefined,
      getObject: () => undefined,
      getObjectMetadata: () => undefined,
      listPageObjects: () => [],
      searchIndex: () => [],
      getRecentOperationOutputs: () => [],
    };
    const frozenVoiceContext: FrozenVoiceTurnContext = {
      pageId: "page-1",
      sceneMode: "blank",
      sceneRevision: 7,
      focusSource: "none",
      focusStale: false,
      capturedAt: 1,
    };
    const catalog: PageTargetCatalog = {
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 7,
      candidates: [],
    };
    const frozenWorld: FrozenWorldContext = {
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 7,
      frozenVoiceContext,
      catalog,
      recentOperations: [],
    };
    const input = shape.inputSchema.parse({
      target: {
        object: "O7",
        part: null,
        region: { x: 0.6, y: 0.65, width: 0.16, height: 0.14 },
        fallbackPoint: null,
      },
    });
    const result = await shape.prepare(input, {
      mode: "SHADOW",
      turnId: "turn-region",
      stepId: "step-1",
      frozenWorld,
      world,
      resolver: new ExistingWorldResolver({ world }),
      resolvedTarget: {
        status: "RESOLVED",
        mode: "OBJECT_REGION",
        objectHandle: "O7",
        objectRef: { kind: "OBJECT", objectId: "image-1" },
        canvasBounds: { x: 300, y: 350, width: 80, height: 70 },
        canvasPoint: { x: 340, y: 385 },
        anchor: {
          kind: "OBJECT",
          objectId: "image-1",
          bounds: { x: 300, y: 350, width: 80, height: 70 },
        },
      },
      getCurrentSceneRevision: () => 7,
    });

    expect(result).toMatchObject({
      status: "READY",
      operations: [{
        data: {
          tldrawOperation: {
            kind: "APPLY_MATH_RENDER_OPERATION",
            operation: {
              kind: "UPSERT_MATH_OBJECT",
              plan: {
                bounds: { x: 300, y: 350, width: 80, height: 70 },
                snapshot: {
                  object: {
                    kind: "shape",
                    shapeType: "circle",
                    geometry: {
                      kind: "circle",
                      center: { x: 40, y: 35 },
                      radius: 28,
                    },
                  },
                },
              },
            },
          },
        },
      }],
    });
  });

  it("keeps unrelated graph/table extension contracts unavailable", () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "PRODUCTION" } as NoteToolContext;
    expect(registry.get("graph.add_tangent")?.isAvailable(context)).toBe(false);
    expect(registry.get("table.update_cell")?.isAvailable(context)).toBe(false);
  });
});

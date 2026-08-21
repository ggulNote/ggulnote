import {
  buildSceneSnapshot,
  describeSceneObject,
  type GraphSceneObject,
  type MathSceneObject,
  type TableSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { DeterministicPartResolver } from "./part-resolver";
import type { UnifiedObjectWorld } from "./unified-object-world";

const GRAPH: GraphSceneObject = {
  id: "graph-1", pageId: "page-1", source: "canvas", kind: "graph",
  bounds: { x: 10, y: 10, width: 200, height: 100 }, zIndex: 1,
  visible: true, locked: false, objectRevision: 1,
  expressions: [{ id: "curve-a", expression: "y=x" }, { id: "curve-b", expression: "y=x^2" }],
  viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, showAxes: true, showGrid: true,
};
const TABLE: TableSceneObject = {
  id: "table-1", pageId: "page-1", source: "canvas", kind: "table",
  bounds: { x: 10, y: 150, width: 200, height: 100 }, zIndex: 1,
  visible: true, locked: false, objectRevision: 1, rows: 2, columns: 2,
  cells: [{ id: "cell-1", row: 1, column: 1, text: "A" }],
};
const MATH: MathSceneObject = {
  id: "math-1", pageId: "page-1", source: "canvas", kind: "math",
  bounds: { x: 10, y: 280, width: 200, height: 60 }, zIndex: 1,
  visible: true, locked: false, objectRevision: 1, latex: "x^2+1",
};

function world(): UnifiedObjectWorld {
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: "page-1", index: 0, width: 600, height: 800 },
    sceneRevision: 1,
    canvasObjects: [GRAPH, TABLE, MATH],
  });
  return {
    getSnapshot: () => scene,
    getObject: (id) => scene.objectById[id],
    getObjectMetadata: (id) => {
      const object = scene.objectById[id];
      return object === undefined ? undefined : describeSceneObject(object);
    },
    listPageObjects: () => scene.objects,
    searchIndex: () => [],
    getRecentOperationOutputs: () => [],
  };
}

describe("DeterministicPartResolver", () => {
  it("resolves graph curve, table row/cell, and formula root without invented part IDs", () => {
    const resolver = new DeterministicPartResolver();
    const source = world();
    expect(resolver.resolve(
      { kind: "OBJECT", objectId: GRAPH.id },
      { kind: "curve", index: 2 },
      source,
    )).toMatchObject({ status: "RESOLVED", ref: { partId: "curve-b" } });
    expect(resolver.resolve(
      { kind: "OBJECT", objectId: TABLE.id },
      { kind: "row", index: 2 },
      source,
    )).toMatchObject({ status: "RESOLVED", ref: { partId: "row:2" } });
    expect(resolver.resolve(
      { kind: "OBJECT", objectId: TABLE.id },
      { kind: "cell", row: 1, column: 1 },
      source,
    )).toMatchObject({ status: "RESOLVED", ref: { partId: "cell-1" } });
    expect(resolver.resolve(
      { kind: "OBJECT", objectId: MATH.id },
      { kind: "expression" },
      source,
    )).toMatchObject({ status: "RESOLVED", ref: { partId: "expression:root" } });
  });

  it("returns compact ambiguity instead of guessing a curve", () => {
    const result = new DeterministicPartResolver().resolve(
      { kind: "OBJECT", objectId: GRAPH.id },
      { kind: "curve" },
      world(),
    );
    expect(result).toMatchObject({ status: "AMBIGUOUS" });
    if (result.status === "AMBIGUOUS") {
      expect(result.candidates.map((candidate) => candidate.label)).toEqual(["C1", "C2"]);
    }
  });
});

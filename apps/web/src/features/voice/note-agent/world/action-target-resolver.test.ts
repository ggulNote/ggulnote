import {
  buildSceneSnapshot,
  describeSceneObject,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { NoteObjectHandleMap } from "../context";
import type { UnifiedObjectWorld } from "./unified-object-world";
import {
  ActionTargetResolver,
  objectLocalPointToCanvasPoint,
  objectLocalRegionToCanvasBounds,
} from "./action-target-resolver";

const PAGE_ID = "page-1";
const REVISION = 7;

function fixture() {
  const object: TextSceneObject = {
    id: "scene-image",
    pageId: PAGE_ID,
    source: "canvas",
    kind: "text",
    bounds: { x: 100, y: 200, width: 400, height: 200 },
    renderBounds: { x: 90, y: 190, width: 420, height: 220 },
    zIndex: 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "shape:image",
    text: "visual target",
    style: { fontSize: 14 },
  };
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: PAGE_ID, index: 0, width: 1_000, height: 800 },
    sceneRevision: REVISION,
    canvasObjects: [object],
  });
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === PAGE_ID && revision === REVISION ? scene : undefined,
    getObject: (objectId) => objectId === object.id ? object : undefined,
    getObjectMetadata: (objectId) => objectId === object.id
      ? describeSceneObject(object, { documentId: "doc-1" })
      : undefined,
    listPageObjects: () => [object],
    searchIndex: () => [],
    getRecentOperationOutputs: () => [],
  };
  const handles = new NoteObjectHandleMap();
  handles.register("O7", { kind: "OBJECT", objectId: object.id });
  return { resolver: new ActionTargetResolver({ world, handles }), object };
}

describe("ActionTargetResolver", () => {
  it("uses the current O7 render bounds for an object target", () => {
    const { resolver, object } = fixture();
    expect(resolver.resolve({ object: "O7", part: null }, PAGE_ID, REVISION))
      .toMatchObject({
        status: "RESOLVED",
        mode: "OBJECT",
        objectHandle: "O7",
        objectRef: { kind: "OBJECT", objectId: object.id },
        canvasBounds: { x: 90, y: 190, width: 420, height: 220 },
      });
  });

  it("transforms an object-local normalized region into canvas geometry", () => {
    const { resolver } = fixture();
    expect(resolver.resolve({
      object: "O7",
      part: null,
      region: { x: 0.5, y: 0.25, width: 0.2, height: 0.5 },
    }, PAGE_ID, REVISION)).toMatchObject({
      status: "RESOLVED",
      mode: "OBJECT_REGION",
      canvasBounds: { x: 300, y: 245, width: 84, height: 110 },
      canvasPoint: { x: 342, y: 300 },
    });
    expect(objectLocalRegionToCanvasBounds(
      { x: 100, y: 200, width: 400, height: 200 },
      { x: 0.5, y: 0.25, width: 0.2, height: 0.5 },
    )).toEqual({ x: 300, y: 250, width: 80, height: 100 });
    expect(objectLocalPointToCanvasPoint(
      { x: 100, y: 200, width: 400, height: 200 },
      { x: 0.75, y: 0.5 },
    )).toEqual({ x: 400, y: 300 });
  });

  it("uses a page-normalized fallback point when object grounding fails", () => {
    const { resolver } = fixture();
    const result = resolver.resolve({
      object: "O99",
      part: null,
      fallbackPoint: { x: 0.75, y: 0.25, coordinateSpace: "PAGE" },
    }, PAGE_ID, REVISION);
    expect(result).toMatchObject({
      status: "RESOLVED",
      mode: "FALLBACK_POINT",
      objectHandle: "O99",
      canvasPoint: { x: 750, y: 200 },
      anchor: { kind: "PAGE" },
    });
  });

  it("fails structurally without guessing when neither object nor fallback resolves", () => {
    const { resolver } = fixture();
    expect(resolver.resolve({ object: "O99", part: null }, PAGE_ID, REVISION))
      .toEqual({ status: "NOT_FOUND", reasonCode: "TARGET_NOT_FOUND" });
  });
});

import {
  buildSceneSnapshot,
  type AnnotationSceneObject,
  type ParagraphSceneObject,
  type SceneSnapshot,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { FakeSpatialSceneSource } from "./testing/fake-spatial-scene-source";
import {
  ExistingSceneSpatialSceneSource,
  classifySpatialProtection,
  type FrozenSpatialSceneReference,
} from "./spatial-scene-source";

const PAGE = { id: "page-1", index: 0, width: 600, height: 800 };

function pdfParagraph(id = "pdf:doc:0:paragraph:p1"): ParagraphSceneObject {
  return {
    id,
    pageId: PAGE.id,
    source: "pdf",
    kind: "paragraph",
    bounds: { x: 40, y: 60, width: 300, height: 80 },
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "p1",
    text: "Transformer architecture overview",
    readingOrder: 1,
    childLineIds: [],
    regionId: "region-1",
  };
}

function canvasText(id = "canvas:page-1:text:note-1"): TextSceneObject {
  return {
    id,
    pageId: PAGE.id,
    source: "canvas",
    kind: "text",
    bounds: { x: 380, y: 100, width: 140, height: 90 },
    zIndex: 2,
    visible: true,
    locked: false,
    objectRevision: 3,
    sourceObjectId: "note-1",
    text: "설명 메모",
    style: { fontSize: 14 },
  };
}

function underline(
  visible = true,
  id = "canvas:page-1:annotation:underline-1",
): AnnotationSceneObject {
  return {
    id,
    pageId: PAGE.id,
    source: "canvas",
    kind: "annotation",
    bounds: { x: 40, y: 142, width: 300, height: 3 },
    zIndex: 3,
    visible,
    locked: false,
    objectRevision: 2,
    annotationType: "underline",
    targetObjectIds: [],
    style: {},
  };
}

function scene(
  mode: "pdf" | "blank",
  revision = 7,
  objects = mode === "pdf"
    ? [pdfParagraph(), canvasText(), underline()]
    : [canvasText(), underline()],
): SceneSnapshot {
  return buildSceneSnapshot({
    mode,
    page: PAGE,
    sceneRevision: revision,
    pdfObjects: objects.filter((object) => object.source === "pdf"),
    canvasObjects: objects.filter((object) => object.source === "canvas"),
  });
}

function reference(
  overrides: Partial<FrozenSpatialSceneReference> = {},
): FrozenSpatialSceneReference {
  return {
    pageId: PAGE.id,
    sceneRevision: 7,
    capturedAt: 100,
    rotation: 0,
    viewportBounds: { x: 50, y: 75, width: 500, height: 650 },
    ...overrides,
  };
}

function source(read: () => SceneSnapshot | undefined) {
  return new ExistingSceneSpatialSceneSource({
    sceneSource: {
      getSnapshot: () => {
        const snapshot = read();
        return snapshot === undefined ? undefined : { scene: snapshot };
      },
    },
  });
}

describe("ExistingSceneSpatialSceneSource", () => {
  it("maps a PDF SceneSnapshot without inventing IDs or geometry", () => {
    const result = source(() => scene("pdf")).getSnapshot(reference());

    expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error("Expected a PDF snapshot.");
    expect(result.snapshot).toMatchObject({
      pageId: PAGE.id,
      sceneRevision: 7,
      mode: "PDF",
      coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
      pageBounds: { x: 0, y: 0, width: 600, height: 800 },
      editableBounds: { x: 0, y: 0, width: 600, height: 800 },
      viewportBounds: { x: 50, y: 75, width: 500, height: 650 },
    });
    expect(result.snapshot.objects.map((object) => object.id)).toEqual([
      "pdf:doc:0:paragraph:p1",
      "canvas:page-1:text:note-1",
      "canvas:page-1:annotation:underline-1",
    ]);
    expect(result.snapshot.objects[0]).toMatchObject({
      bounds: { x: 40, y: 60, width: 300, height: 80 },
      renderBounds: { x: 40, y: 60, width: 300, height: 80 },
      sourceLayer: "PDF_BASE",
      semanticRole: "TEXT",
      protection: "HARD",
    });
  });

  it("maps a blank canvas and keeps annotation protection separate", () => {
    const result = source(() => scene("blank")).getSnapshot(reference());

    expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error("Expected a blank snapshot.");
    expect(result.snapshot.mode).toBe("BLANK");
    expect(result.snapshot.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceLayer: "CANVAS", protection: "HARD" }),
      expect.objectContaining({ sourceLayer: "ANNOTATION", protection: "SOFT" }),
    ]));
  });

  it("stores canonical geometry independently from zoom and DPR metadata", () => {
    const spatialSource = source(() => scene("pdf"));
    const first = spatialSource.getSnapshot({
      ...reference(),
      zoom: 1,
      devicePixelRatio: 1,
    } as FrozenSpatialSceneReference);
    const second = spatialSource.getSnapshot({
      ...reference(),
      zoom: 3,
      devicePixelRatio: 2,
    } as FrozenSpatialSceneReference);

    expect(first).toEqual(second);
  });

  it("freezes scene revision, focus, selection, and object geometry", () => {
    const original = scene("pdf");
    const focusBounds = { x: 40, y: 60, width: 300, height: 80 };
    const selectionIds = ["canvas:page-1:text:note-1"];
    const result = source(() => original).getSnapshot(reference({
      focus: {
        source: "VOICE_FROZEN_CONTEXT",
        objectId: "pdf:doc:0:paragraph:p1",
        bounds: focusBounds,
      },
      selection: {
        objectIds: selectionIds,
        bounds: { x: 380, y: 100, width: 140, height: 90 },
      },
    }));
    if (result.status !== "READY") throw new Error("Expected a frozen snapshot.");

    focusBounds.x = 500;
    selectionIds[0] = "changed";
    original.objects[0]!.bounds.x = 500;

    expect(result.snapshot.sceneRevision).toBe(7);
    expect(result.snapshot.focus?.bounds?.x).toBe(40);
    expect(result.snapshot.selection?.objectIds).toEqual([
      "canvas:page-1:text:note-1",
    ]);
    expect(result.snapshot.objects[0]?.bounds.x).toBe(40);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.objects)).toBe(true);
  });

  it("centralizes hard, soft, and ignore protection classification", () => {
    expect(classifySpatialProtection(pdfParagraph())).toBe("HARD");
    expect(classifySpatialProtection(canvasText())).toBe("HARD");
    expect(classifySpatialProtection(underline())).toBe("SOFT");
    expect(classifySpatialProtection(underline(false))).toBe("IGNORE");
  });

  it("returns STALE_SCENE instead of reading a mismatched current revision", () => {
    const current = scene("pdf", 8);
    expect(source(() => current).getSnapshot(reference())).toEqual({
      status: "STALE_SCENE",
    });
    expect(source(() => scene("pdf")).getSnapshot(reference({
      focus: {
        source: "VOICE_FROZEN_CONTEXT",
        objectId: "missing-object",
      },
    }))).toEqual({ status: "STALE_SCENE" });
  });

  it("rejects invalid canonical viewport geometry without clamping it", () => {
    expect(source(() => scene("pdf")).getSnapshot(reference({
      viewportBounds: { x: 590, y: 0, width: 50, height: 100 },
    }))).toEqual({
      status: "UNSUPPORTED",
      reason: "INVALID_SCENE_GEOMETRY",
    });
  });
});

describe("FakeSpatialSceneSource", () => {
  it("returns a controlled result and records requests", () => {
    const fake = new FakeSpatialSceneSource({ status: "STALE_SCENE" });
    expect(fake.getSnapshot(reference())).toEqual({ status: "STALE_SCENE" });
    expect(fake.requests).toHaveLength(1);
    fake.setResult({
      status: "UNSUPPORTED",
      reason: "INVALID_SCENE_GEOMETRY",
    });
    expect(fake.getSnapshot(reference())).toMatchObject({ status: "UNSUPPORTED" });
  });
});

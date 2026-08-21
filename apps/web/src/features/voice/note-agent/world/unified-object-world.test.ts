import { describe, expect, it } from "vitest";
import {
  EditorEngine,
  buildSceneSnapshot,
  describeSceneObject,
  type AnnotationSceneObject,
  type ParagraphSceneObject,
  type SceneObject,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import type { DirectOperationRecord } from "../../domain";
import {
  buildEditorVoiceContextRead,
  editorAnnotationSceneId,
} from "../../integration/editor-voice-context";
import { DirectCommandOperationLedgerAdapter } from "./operation-ledger";
import { RebuildableObjectIndex } from "./object-index";
import {
  ExistingUnifiedObjectWorld,
  type UnifiedObjectWorldSnapshot,
  type UnifiedObjectWorldSnapshotSource,
} from "./unified-object-world";

const DOCUMENT_ID = "doc-1";
const PDF_PAGE_ID = "doc-1-page-1";
const BLANK_PAGE_ID = "doc-1-page-2";

function paragraph(): ParagraphSceneObject {
  return {
    id: "pdf:doc-1:0:paragraph:p-1",
    pageId: PDF_PAGE_ID,
    source: "pdf",
    kind: "paragraph",
    bounds: { x: 40, y: 60, width: 300, height: 80 },
    renderBounds: { x: 39, y: 59, width: 302, height: 82 },
    zIndex: 0,
    visible: true,
    locked: true,
    objectRevision: 1,
    sourceObjectId: "p-1",
    text: "Unified PDF paragraph",
    readingOrder: 1,
    childLineIds: [],
    regionId: "region-1",
  };
}

function canvasText(
  text = "사용자가 만든 안녕하세요",
  revision = 1,
): TextSceneObject {
  return {
    id: "canvas:doc-1-page-2:text:annotation-text-1",
    pageId: BLANK_PAGE_ID,
    source: "canvas",
    kind: "text",
    bounds: { x: 20, y: 30, width: 180, height: 40 },
    zIndex: 2,
    visible: true,
    locked: false,
    objectRevision: revision,
    sourceObjectId: "annotation-text-1",
    text,
    style: { fontSize: 14 },
    createdAt: 100,
    updatedAt: 100 + revision,
    createdByTurnId: "turn-create-text",
    creationOrder: 7,
  };
}

function underline(): AnnotationSceneObject {
  return {
    id: "canvas:doc-1-page-2:annotation:underline-1",
    pageId: BLANK_PAGE_ID,
    source: "canvas",
    kind: "annotation",
    bounds: { x: 20, y: 90, width: 180, height: 20 },
    renderBounds: { x: 20, y: 90, width: 180, height: 21 },
    rects: [
      { x: 20, y: 90, width: 90, height: 8 },
      { x: 20, y: 102, width: 180, height: 8 },
    ],
    zIndex: 3,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "underline-1",
    annotationType: "underline",
    targetObjectIds: [canvasText().id],
    style: { color: "#111827", thickness: 2 },
    createdAt: 200,
    updatedAt: 200,
    createdByTurnId: "turn-create-underline",
    creationOrder: 8,
  };
}

function makeSnapshots(): readonly UnifiedObjectWorldSnapshot[] {
  const pdfScene = buildSceneSnapshot({
    mode: "pdf",
    page: { id: PDF_PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: 3,
    pdfObjects: [paragraph()],
  });
  const blankScene = buildSceneSnapshot({
    mode: "blank",
    page: { id: BLANK_PAGE_ID, index: 1, width: 600, height: 800 },
    sceneRevision: 4,
    canvasObjects: [canvasText(), underline()],
  });
  return [
    { documentId: DOCUMENT_ID, scene: pdfScene },
    { documentId: DOCUMENT_ID, scene: blankScene },
  ];
}

class SnapshotSource implements UnifiedObjectWorldSnapshotSource {
  public constructor(
    private readonly snapshots: readonly UnifiedObjectWorldSnapshot[],
  ) {}

  public getSnapshot(reference: {
    readonly pageId: string;
    readonly sceneRevision: number;
  }): UnifiedObjectWorldSnapshot | undefined {
    return this.snapshots.find((snapshot) =>
      snapshot.scene.page.id === reference.pageId
      && snapshot.scene.sceneRevision === reference.sceneRevision);
  }
}

function operationRecord(): DirectOperationRecord {
  return {
    turnId: "turn-create-text",
    planId: "plan-create-text",
    relation: "NEW",
    command: {
      capability: "text",
      operation: "create",
      target: { kind: "CURRENT_PAGE" },
      payload: { text: "사용자가 만든 안녕하세요" },
    },
    target: { kind: "CURRENT_PAGE" },
    resultStatus: "COMMITTED",
    editorOperationId: "editor-operation-1",
    editorAnnotationId: "annotation-text-1",
    committedAt: 300,
  };
}

describe("Unified Object World", () => {
  it("uses one lookup contract for PDF, blank canvas text, and annotations", () => {
    const snapshots = makeSnapshots();
    const ledger = new DirectCommandOperationLedgerAdapter({
      records: { getRecords: () => [operationRecord()] },
      resolveOutputObject: (record) => {
        const object = snapshots
          .flatMap((snapshot) => snapshot.scene.objects)
          .find((candidate) =>
            candidate.sourceObjectId === record.editorAnnotationId);
        return object === undefined
          ? undefined
          : { objectId: object.id, pageId: object.pageId };
      },
    });
    const world = new ExistingUnifiedObjectWorld({
      snapshotSource: new SnapshotSource(snapshots),
      operationLedger: ledger,
    });

    expect(world.getSnapshot(PDF_PAGE_ID, 3)).toBeDefined();
    expect(world.getSnapshot(BLANK_PAGE_ID, 4)).toBeDefined();
    expect(world.getObject(paragraph().id)?.kind).toBe("paragraph");
    expect(world.getObject(canvasText().id)?.kind).toBe("text");
    expect(world.getObject(underline().id)?.kind).toBe("annotation");

    const pdfMetadata = world.getObjectMetadata(paragraph().id);
    const textMetadata = world.getObjectMetadata(canvasText().id);
    const annotationMetadata = world.getObjectMetadata(underline().id);
    expect(pdfMetadata).toMatchObject({
      source: "PDF_BASE",
      renderBounds: paragraph().renderBounds,
      capabilities: {
        anchorable: true,
        annotatable: true,
        editable: false,
        movable: false,
        resizable: false,
        deletable: false,
        textRangeAddressable: true,
        partAddressable: true,
      },
    });
    expect(textMetadata).toMatchObject({
      source: "USER_CANVAS",
      searchableText: "사용자가 만든 안녕하세요",
      createdByTurnId: "turn-create-text",
      creationOrder: 7,
      capabilities: { editable: true, movable: true, deletable: true },
    });
    expect(annotationMetadata).toMatchObject({
      source: "USER_ANNOTATION",
      rects: underline().rects,
      capabilities: { anchorable: true, resizable: false },
    });

    expect(world.searchIndex({
      pageId: BLANK_PAGE_ID,
      sources: ["USER_CANVAS"],
      text: "안녕하세요",
    })).toHaveLength(1);
    expect(world.searchIndex({
      pageId: BLANK_PAGE_ID,
      kinds: ["annotation"],
      semanticAttributes: { annotationType: "underline" },
    })).toHaveLength(1);
    expect(world.searchIndex({ sort: "CREATION_DESC" }).map((entry) =>
      entry.objectId)).toEqual([
      underline().id,
      canvasText().id,
      paragraph().id,
    ]);
    expect(world.getRecentOperationOutputs({ pageId: BLANK_PAGE_ID })).toEqual([
      { kind: "OBJECT", objectId: canvasText().id },
    ]);
    expect(ledger.list({ pageId: BLANK_PAGE_ID })[0]).toMatchObject({
      operationId: "editor-operation-1",
      sourceTurnId: "turn-create-text",
      toolId: "text.create",
      undoGroupId: "editor-operation-1",
    });
  });

  it("rebuilds and incrementally updates a revision-bound derived index", () => {
    const index = new RebuildableObjectIndex();
    const initial = buildSceneSnapshot({
      mode: "blank",
      page: { id: BLANK_PAGE_ID, index: 1, width: 600, height: 800 },
      sceneRevision: 10,
      canvasObjects: [canvasText(), underline()],
    });
    const rebuilt = index.rebuild(DOCUMENT_ID, initial);
    expect(rebuilt.status).toBe("REBUILT");
    expect(index.rebuild(DOCUMENT_ID, initial).status).toBe("UNCHANGED");

    const updated = canvasText("수정된 검색 내용", 2);
    expect(index.applyChanges({
      documentId: DOCUMENT_ID,
      pageId: BLANK_PAGE_ID,
      sceneRevision: 11,
      upserts: [updated],
    }).status).toBe("UPDATED");
    expect(index.search({ text: "수정된", sceneRevision: 11 })).toHaveLength(1);
    expect(index.search({ text: "수정된", sceneRevision: 10 })).toEqual([]);
    expect(index.applyChanges({
      documentId: DOCUMENT_ID,
      pageId: BLANK_PAGE_ID,
      sceneRevision: 9,
      deletedObjectIds: [updated.id],
    }).status).toBe("STALE_REVISION");

    expect(index.applyChanges({
      documentId: DOCUMENT_ID,
      pageId: BLANK_PAGE_ID,
      sceneRevision: 12,
      deletedObjectIds: [underline().id],
    }).status).toBe("UPDATED");
    const incremental = index.search({
      pageId: BLANK_PAGE_ID,
      sort: "CREATION_ASC",
    });
    const rebuiltSnapshot = buildSceneSnapshot({
      mode: "blank",
      page: { id: BLANK_PAGE_ID, index: 1, width: 600, height: 800 },
      sceneRevision: 12,
      canvasObjects: [updated],
    });
    index.invalidate(DOCUMENT_ID, BLANK_PAGE_ID);
    index.rebuild(DOCUMENT_ID, rebuiltSnapshot);
    expect(index.search({
      pageId: BLANK_PAGE_ID,
      sort: "CREATION_ASC",
    })).toEqual(incremental);
  });

  it("restores stable user text and multi-rect annotation metadata after hydration", () => {
    const source = new EditorEngine({
      idGenerator: (() => {
        const ids = ["text-1", "underline-1"];
        return () => ids.shift() ?? "unexpected";
      })(),
    });
    source.setDocument(DOCUMENT_ID);
    source.setActivePage(BLANK_PAGE_ID, { width: 600, height: 800 });
    source.createAnnotation({
      type: "TEXT",
      pageId: BLANK_PAGE_ID,
      bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
      text: "refresh 뒤에도 같은 텍스트",
      createdByTurnId: "turn-persisted",
      creationOrder: 12,
    });
    source.createAnnotation({
      type: "UNDERLINE",
      pageId: BLANK_PAGE_ID,
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
      rects: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
        { x: 0.1, y: 0.24, width: 0.2, height: 0.02 },
      ],
      targetObjectIds: ["pdf:doc-1:0:paragraph:p-1"],
      createdByTurnId: "turn-underline",
      creationOrder: 13,
    });
    const persisted = source.exportPageSnapshot(BLANK_PAGE_ID);

    const hydrated = new EditorEngine();
    hydrated.setDocument(DOCUMENT_ID);
    hydrated.setActivePage(BLANK_PAGE_ID, { width: 600, height: 800 });
    hydrated.hydratePage(persisted);
    const refreshed = hydrated.exportPageSnapshot(BLANK_PAGE_ID);
    const context = buildEditorVoiceContextRead({
      documentId: DOCUMENT_ID,
      mode: "blank",
      pageId: BLANK_PAGE_ID,
      pageIndex: 1,
      pageSize: { width: 600, height: 800 },
      sceneRevision: refreshed.revision,
      pageSnapshot: refreshed,
    });
    const serializedText = refreshed.annotations.find((item) => item.type === "TEXT");
    const serializedUnderline = refreshed.annotations.find((item) =>
      item.type === "UNDERLINE");
    if (serializedText === undefined || serializedUnderline === undefined) {
      throw new Error("Expected hydrated user objects.");
    }
    const textObjectId = editorAnnotationSceneId(serializedText);
    const underlineObjectId = editorAnnotationSceneId(serializedUnderline);
    expect(context.scene.objectById[textObjectId]).toMatchObject({
      sourceObjectId: "text-1",
      text: "refresh 뒤에도 같은 텍스트",
      createdByTurnId: "turn-persisted",
      creationOrder: 12,
    });
    expect(context.scene.objectById[underlineObjectId]).toMatchObject({
      sourceObjectId: "underline-1",
      targetObjectIds: ["pdf:doc-1:0:paragraph:p-1"],
      createdByTurnId: "turn-underline",
      creationOrder: 13,
      rects: [
        { x: 60, y: 160, width: 180, height: 16 },
        { x: 60, y: 192, width: 120, height: 16 },
      ],
    });
    expect(describeSceneObject(
      context.scene.objectById[underlineObjectId] as SceneObject,
    ).capabilities.resizable).toBe(false);
  });
});

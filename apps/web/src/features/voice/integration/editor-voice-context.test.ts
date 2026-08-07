import type { PageSceneSnapshot } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import {
  buildEditorVoiceContextRead,
  editorAnnotationSceneId,
} from "./editor-voice-context";

const pageSnapshot: PageSceneSnapshot = {
  documentId: "doc-1",
  pageId: "page-1",
  pageNumber: 1,
  revision: 3,
  annotations: [
    {
      schemaVersion: 1,
      id: "annotation-1",
      pageId: "page-1",
      type: "TEXT",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      zIndex: 2,
      properties: {
        text: "선택된 메모",
        fontSize: 16,
        textAlign: "left",
      },
      createdAt: 10,
      updatedAt: 20,
    },
  ],
};

describe("editor voice context adapter", () => {
  it("builds a SceneSnapshot read model without copying editor state", () => {
    const input = {
      documentId: "doc-1",
      mode: "blank" as const,
      pageId: "page-1",
      pageIndex: 0,
      pageSize: { width: 1_000, height: 2_000 },
      sceneRevision: 12,
      pageSnapshot,
      selectedAnnotationId: "annotation-1",
    };
    const result = buildEditorVoiceContextRead(input);
    const objectId = editorAnnotationSceneId(pageSnapshot.annotations[0]!);

    expect(result.scene.sceneRevision).toBe(12);
    expect(result.scene.objectById[objectId]).toMatchObject({
      kind: "text",
      bounds: { x: 100, y: 400, width: 300, height: 200 },
      text: "선택된 메모",
    });
    expect(result.focus.selection).toMatchObject({
      source: "selection",
      objectId,
      bounds: { x: 100, y: 400, width: 300, height: 200 },
    });
    expect(pageSnapshot.annotations[0]?.bounds).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
    });
  });

  it("keeps a page fallback when no object focus exists", () => {
    const result = buildEditorVoiceContextRead({
      documentId: "doc-1",
      mode: "blank",
      pageId: "page-1",
      pageIndex: 0,
      pageSize: { width: 595, height: 842 },
      sceneRevision: 1,
      pageSnapshot: { ...pageSnapshot, annotations: [] },
    });
    expect(result.focus).toEqual({
      page: { source: "page", capturedAt: 0 },
    });
  });

  it("rejects an unavailable canonical page", () => {
    expect(() => buildEditorVoiceContextRead({
      documentId: "doc-1",
      mode: "blank",
      pageId: "page-1",
      pageIndex: 0,
      pageSize: { width: 0, height: 842 },
      sceneRevision: 1,
      pageSnapshot,
    })).toThrow("positive canonical page size");
  });
});

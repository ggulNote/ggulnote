import {
  buildSceneSnapshot,
  describeSceneObject,
  type ParagraphSceneObject,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type { FrozenVoiceTurnContext, PageTargetCatalog } from "../../domain";
import {
  ExistingWorldResolver,
  RebuildableObjectIndex,
  type FrozenWorldContext,
  type UnifiedObjectWorld,
} from "../world";
import { createExistingNoteToolRegistry } from "./existing-tool-adapters";
import type { NoteToolContext } from "./note-tool-registry";

const PDF: ParagraphSceneObject = {
  id: "pdf-paragraph",
  pageId: "page-1",
  source: "pdf",
  kind: "paragraph",
  bounds: { x: 20, y: 20, width: 300, height: 80 },
  renderBounds: { x: 19, y: 19, width: 302, height: 82 },
  zIndex: 0,
  visible: true,
  locked: true,
  objectRevision: 1,
  sourceObjectId: "paragraph-1",
  text: "PDF immutable text",
  readingOrder: 1,
  childLineIds: [],
  regionId: "region-1",
};

const USER_TEXT: TextSceneObject = {
  id: "canvas-text",
  pageId: "page-1",
  source: "canvas",
  kind: "text",
  bounds: { x: 20, y: 150, width: 160, height: 40 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "text-1",
  text: "내가 쓴 안녕하세요",
  style: { fontSize: 14 },
  createdAt: 10,
  updatedAt: 10,
  creationOrder: 1,
};

function context(): NoteToolContext {
  const scene = buildSceneSnapshot({
    mode: "pdf",
    page: { id: "page-1", index: 0, width: 600, height: 800 },
    sceneRevision: 7,
    pdfObjects: [PDF],
    canvasObjects: [USER_TEXT],
  });
  const index = new RebuildableObjectIndex();
  index.rebuild("doc-1", scene);
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === "page-1" && revision === 7 ? scene : undefined,
    getObject: (id) => scene.objectById[id],
    getObjectMetadata: (id) => {
      const object = scene.objectById[id];
      return object === undefined ? undefined : describeSceneObject(object, { documentId: "doc-1" });
    },
    listPageObjects: () => scene.objects,
    searchIndex: (query) => index.search(query),
    getRecentOperationOutputs: () => [],
  };
  const frozenVoiceContext: FrozenVoiceTurnContext = {
    pageId: "page-1",
    sceneMode: "pdf",
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
  return {
    mode: "SHADOW",
    turnId: "turn-1",
    frozenWorld,
    world,
    resolver: new ExistingWorldResolver({ world }),
    getCurrentSceneRevision: () => 7,
  };
}

describe("existing NoteTool adapters", () => {
  it("registers only supported adapters and gates placement-dependent create", () => {
    const registry = createExistingNoteToolRegistry();
    expect(registry.get("text.create")).toBeDefined();
    expect(registry.get("text.replace")).toBeDefined();
    expect(registry.get("annotation.apply")).toBeDefined();
    expect(registry.get("navigation.next_page")).toBeDefined();
    expect(registry.get("navigation.previous_page")).toBeDefined();
    expect(registry.get("history.undo")).toBeDefined();
    expect(registry.get("object.delete")).toBeUndefined();
    expect(registry.compactSchemas(context()).map((tool) => tool.id))
      .not.toContain("text.create");
  });

  it("allows editable user text but refuses immutable PDF replacement", async () => {
    const registry = createExistingNoteToolRegistry();
    const tool = registry.get("text.replace");
    if (tool === undefined) throw new Error("Expected text.replace adapter.");
    const toolContext = context();
    const userInput = tool.inputSchema.parse({
      target: { source: "USER_CREATED", content: { text: "안녕하세요" } },
      text: "수정됨",
    });
    await expect(tool.execute(userInput, toolContext)).resolves
      .toMatchObject({ status: "SUCCESS" });
    const pdfInput = tool.inputSchema.parse({
      target: { source: "PDF_BASE", content: { text: "PDF immutable text" } },
      text: "수정 시도",
    });
    await expect(tool.execute(pdfInput, toolContext)).resolves.toEqual({
      status: "NOT_ALLOWED",
      reasonCode: "TARGET_NOT_EDITABLE",
    });
  });
});

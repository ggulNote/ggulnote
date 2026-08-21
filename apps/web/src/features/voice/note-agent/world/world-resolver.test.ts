import {
  buildSceneSnapshot,
  describeSceneObject,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  FrozenVoiceTurnContext,
  PageTargetCandidate,
  PageTargetCatalog,
} from "../../domain";
import { RebuildableObjectIndex } from "./object-index";
import type { UnifiedObjectWorld } from "./unified-object-world";
import { ExistingWorldResolver, type FrozenWorldContext } from "./world-resolver";

const DOCUMENT_ID = "doc-1";
const PAGE_ID = "page-1";
const REVISION = 7;

function textObject(
  id: string,
  text: string,
  x: number,
  y: number,
  creationOrder: number,
): TextSceneObject {
  return {
    id,
    pageId: PAGE_ID,
    source: "canvas",
    kind: "text",
    bounds: { x, y, width: 120, height: 30 },
    renderBounds: { x: x - 1, y: y - 1, width: 122, height: 32 },
    zIndex: creationOrder,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: id,
    text,
    style: { fontSize: 14 },
    createdAt: creationOrder * 10,
    updatedAt: creationOrder * 10,
    creationOrder,
  };
}

function fixture(objects: readonly TextSceneObject[]) {
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: REVISION,
    canvasObjects: objects,
  });
  const index = new RebuildableObjectIndex();
  index.rebuild(DOCUMENT_ID, scene);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === PAGE_ID && revision === REVISION ? scene : undefined,
    getObject: (objectId) => byId.get(objectId),
    getObjectMetadata: (objectId) => {
      const object = byId.get(objectId);
      return object === undefined
        ? undefined
        : describeSceneObject(object, { documentId: DOCUMENT_ID });
    },
    listPageObjects: (pageId) => pageId === PAGE_ID ? objects : [],
    searchIndex: (query) => index.search(query),
    getRecentOperationOutputs: () => [],
  };
  return { world, scene };
}

function candidate(
  overrides: Partial<PageTargetCandidate> = {},
): PageTargetCandidate {
  return {
    candidateId: "candidate:pdf-line",
    source: "pdf",
    type: "line",
    pageId: PAGE_ID,
    sceneObjectId: "pdf-line",
    text: "Moreover from a concrete instance",
    bounds: { x: 20, y: 20, width: 300, height: 30 },
    editable: false,
    annotatable: true,
    semanticUnit: "line",
    readingOrder: 1,
    ...overrides,
  };
}

function context(
  catalogCandidates: readonly PageTargetCandidate[] = [],
): FrozenWorldContext {
  const frozenVoiceContext: FrozenVoiceTurnContext = {
    pageId: PAGE_ID,
    sceneMode: "blank",
    sceneRevision: REVISION,
    focusSource: "selection",
    focusStale: false,
    capturedAt: 1,
  };
  const catalog: PageTargetCatalog = {
    documentId: DOCUMENT_ID,
    pageId: PAGE_ID,
    sceneRevision: REVISION,
    candidates: catalogCandidates,
  };
  return {
    documentId: DOCUMENT_ID,
    pageId: PAGE_ID,
    sceneRevision: REVISION,
    frozenVoiceContext,
    catalog,
    recentOperations: [],
    focus: { kind: "OBJECT", objectId: "focus-object" },
    selection: { kind: "OBJECT", objectId: "focus-object" },
  };
}

describe("ExistingWorldResolver", () => {
  it("reuses Stage 3.5 fuzzy PDF grounding", async () => {
    const { world } = fixture([]);
    const result = await new ExistingWorldResolver({ world }).resolve({
      source: "PDF_BASE",
      content: { text: "Morover from a concrete instance" },
    }, context([candidate()]));
    expect(result.status).toBe("RESOLVED");
  });

  it("uses canonical render geometry for user-created spatial anchors", async () => {
    const anchor = textObject("canvas-anchor", "안녕하세요", 100, 100, 1);
    const below = textObject("canvas-below", "중요", 110, 180, 2);
    const beside = textObject("canvas-beside", "옆", 260, 100, 3);
    const { world } = fixture([anchor, below, beside]);
    const result = await new ExistingWorldResolver({ world }).resolve({
      kinds: ["text"],
      content: { text: "중요" },
      spatial: [{
        relation: "BELOW",
        reference: {
          kind: "ENTITY",
          selector: { source: "USER_CREATED", content: { text: "안녕하세요" } },
        },
      }],
    }, context());
    expect(result).toEqual({
      status: "RESOLVED",
      ref: { kind: "OBJECT", objectId: below.id },
    });
  });

  it("does not replace a missing explicit target with focus or selection", async () => {
    const focus = textObject("focus-object", "선택된 텍스트", 10, 10, 1);
    const { world } = fixture([focus]);
    const resolver = new ExistingWorldResolver({ world });
    await expect(resolver.resolve({ content: { text: "존재하지 않음" } }, context()))
      .resolves.toEqual({ status: "NOT_FOUND" });
    await expect(resolver.resolve({ context: "SELECTION" }, context()))
      .resolves.toEqual({
        status: "RESOLVED",
        ref: { kind: "OBJECT", objectId: "focus-object" },
      });
  });

  it("returns only compact bounded ambiguity candidates", async () => {
    const objects = Array.from({ length: 7 }, (_, index) =>
      textObject(`duplicate-${index}`, "duplicate", 10, 50 * index, index + 1));
    const { world } = fixture(objects);
    const result = await new ExistingWorldResolver({ world }).resolve({
      source: "USER_CREATED",
      content: { text: "duplicate" },
    }, context());
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      expect(result.candidates).toHaveLength(4);
      expect(result.candidates.map((entry) => entry.label)).toEqual(["C1", "C2", "C3", "C4"]);
    }
  });
});

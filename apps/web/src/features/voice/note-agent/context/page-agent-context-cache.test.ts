import { describe, expect, it } from "vitest";
import type { NoteCatalogObject } from "../domain";
import { PageAgentContextCache } from "./page-agent-context-cache";

function catalogObject(
  handle: `O${number}`,
  text: string,
  overrides: Partial<NoteCatalogObject> = {},
): NoteCatalogObject {
  return {
    handle,
    source: "pdf",
    kind: "paragraph",
    text,
    bounds: { x: 0.1, y: 0.2, width: 0.5, height: 0.2 },
    capabilities: ["textRangeAddressable"],
    selected: false,
    focused: false,
    recent: false,
    ...overrides,
  };
}

describe("PageAgentContextCache", () => {
  it("freezes restored state for one activation and rebases after re-entry", () => {
    const cache = new PageAgentContextCache();
    const initial = catalogObject(
      cache.handleFor("session-a", "page-3", "note-1"),
      "persisted note",
      { source: "tldraw", kind: "text" },
    );
    const firstBase = cache.activate({
      documentId: "session-a",
      pageId: "page-3",
      contextRevision: 4,
      sceneMode: "blank",
      objects: [initial],
      persistedAt: 100,
    });

    const changed = catalogObject("O1", "edited note", {
      source: "tldraw",
      kind: "text",
    });
    const duringActivation = cache.build({
      documentId: "session-a",
      pageId: "page-3",
      sceneRevision: 30,
      sceneMode: "blank",
      objects: [changed],
      createdAt: 999,
    });

    expect(duringActivation.pageBase).toBe(firstBase);
    expect(duringActivation.pageBase).toMatchObject({
      baseRevision: "page-3@4",
      createdAt: 100,
    });
    expect(duringActivation.pageBase.objects[0]?.text).toBe("persisted note");
    expect(duringActivation.liveScene.updatedObjects[0]?.text).toBe("edited note");

    const rebased = cache.activate({
      documentId: "session-a",
      pageId: "page-3",
      contextRevision: 5,
      sceneMode: "blank",
      objects: [changed],
      persistedAt: 200,
    });
    const afterReentry = cache.build({
      documentId: "session-a",
      pageId: "page-3",
      sceneRevision: 31,
      sceneMode: "blank",
      objects: [changed],
      createdAt: 1_000,
    });

    expect(rebased).not.toBe(firstBase);
    expect(afterReentry.pageBase).toBe(rebased);
    expect(afterReentry.pageBase).toMatchObject({
      baseRevision: "page-3@5",
      createdAt: 200,
    });
    expect(afterReentry.pageBase.objects[0]?.text).toBe("edited note");
    expect(afterReentry.liveScene.createdObjects).toEqual([]);
    expect(afterReentry.liveScene.updatedObjects).toEqual([]);
    expect(afterReentry.liveScene.deletedObjectIds).toEqual([]);

    const unchangedReentry = cache.activate({
      documentId: "session-a",
      pageId: "page-3",
      contextRevision: 5,
      sceneMode: "blank",
      objects: [changed],
      persistedAt: 200,
    });
    expect(unchangedReentry).toEqual(rebased);
  });

  it("keeps activation state isolated by Session and page identity", () => {
    const cache = new PageAgentContextCache();
    const sessionA = catalogObject(
      cache.handleFor("session-a", "page-1", "note"),
      "A",
      { source: "tldraw", kind: "text" },
    );
    const sessionB = catalogObject(
      cache.handleFor("session-b", "page-1", "note"),
      "B",
      { source: "tldraw", kind: "text" },
    );
    cache.activate({
      documentId: "session-a",
      pageId: "page-1",
      contextRevision: 1,
      sceneMode: "blank",
      objects: [sessionA],
      persistedAt: 10,
    });
    cache.activate({
      documentId: "session-b",
      pageId: "page-1",
      contextRevision: 7,
      sceneMode: "blank",
      objects: [sessionB],
      persistedAt: 20,
    });

    const restoredA = cache.build({
      documentId: "session-a",
      pageId: "page-1",
      sceneRevision: 50,
      sceneMode: "blank",
      objects: [sessionA],
      createdAt: 500,
    });
    const restoredB = cache.build({
      documentId: "session-b",
      pageId: "page-1",
      sceneRevision: 51,
      sceneMode: "blank",
      objects: [sessionB],
      createdAt: 501,
    });

    expect(restoredA.pageBase.baseRevision).toBe("page-1@1");
    expect(restoredA.pageBase.objects[0]?.text).toBe("A");
    expect(restoredB.pageBase.baseRevision).toBe("page-1@7");
    expect(restoredB.pageBase.objects[0]?.text).toBe("B");
  });

  it("keeps the first page base immutable and appends live create/update/delete state", () => {
    const cache = new PageAgentContextCache();
    const fullParagraph = `${"full canonical paragraph ".repeat(12)}tail`;
    expect(cache.handleFor("doc-1", "page-1", "pdf-paragraph")).toBe("O1");
    const first = cache.build({
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 3,
      sceneMode: "pdf",
      objects: [catalogObject("O1", fullParagraph, { selected: true })],
      createdAt: 100,
    });

    expect(first.pageBase).toMatchObject({
      baseRevision: "page-1@3",
      pageText: fullParagraph,
      createdAt: 100,
    });
    expect(first.pageBase.objects[0]?.text).toBe(fullParagraph);
    expect(first.pageBase.objects[0]?.selected).toBe(false);
    expect(first.liveScene).toMatchObject({
      sceneRevision: 3,
      createdObjects: [],
      updatedObjects: [],
      deletedObjectIds: [],
      selectedObjectIds: ["O1"],
    });

    expect(cache.handleFor("doc-1", "page-1", "canvas-note")).toBe("O2");
    const second = cache.build({
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 4,
      sceneMode: "pdf",
      objects: [
        catalogObject("O1", `${fullParagraph} updated`),
        catalogObject("O2", "live note", {
          source: "tldraw",
          kind: "text",
          recent: true,
        }),
      ],
      createdAt: 200,
    });

    expect(second.pageBase).toBe(first.pageBase);
    expect(second.pageBase.objects[0]?.text).toBe(fullParagraph);
    expect(second.pageBase.createdAt).toBe(100);
    expect(second.liveScene.updatedObjects.map((object) => object.handle)).toEqual(["O1"]);
    expect(second.liveScene.createdObjects.map((object) => object.handle)).toEqual(["O2"]);
    expect(second.liveScene.recentObjectIds).toEqual(["O2"]);

    const third = cache.build({
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 5,
      sceneMode: "pdf",
      objects: [catalogObject("O1", fullParagraph)],
      createdAt: 300,
    });
    expect(third.liveScene.deletedObjectIds).toEqual(["O2"]);
  });

  it("keeps handles stable when later objects would sort before the base object", () => {
    const cache = new PageAgentContextCache();
    expect(cache.handleFor("doc-1", "page-1", "pdf-object")).toBe("O1");
    expect(cache.handleFor("doc-1", "page-1", "new-canvas-object")).toBe("O2");
    expect(cache.handleFor("doc-1", "page-1", "pdf-object")).toBe("O1");
  });
});

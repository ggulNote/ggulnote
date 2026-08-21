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

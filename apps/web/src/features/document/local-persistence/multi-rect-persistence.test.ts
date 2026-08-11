import "fake-indexeddb/auto";
import { EditorEngine, type PageSceneSnapshot } from "@ggulnote/editor-core";
import { afterEach, describe, expect, it } from "vitest";
import { GgulnoteLocalDatabase } from "./database";

const databases: GgulnoteLocalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("multi-rect local persistence", () => {
  it("roundtrips ordered rects through the existing pageSnapshots store", async () => {
    const name = `multi-rect-${crypto.randomUUID()}`;
    const database = new GgulnoteLocalDatabase(name);
    databases.push(database);
    await database.open();
    const rects = [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
      { x: 0.1, y: 0.24, width: 0.2, height: 0.02 },
    ];
    const snapshot: PageSceneSnapshot = {
      documentId: "doc-1",
      pageId: "doc-1-page-1",
      pageNumber: 1,
      revision: 1,
      annotations: [{
        schemaVersion: 1,
        id: "annotation-1",
        pageId: "doc-1-page-1",
        type: "HIGHLIGHT",
        bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.06 },
        rects,
        zIndex: 1,
        properties: { color: "#facc15", opacity: 0.35 },
        createdAt: 1,
        updatedAt: 1,
      }],
    };

    await database.pageSnapshots.put({
      id: "doc-1:doc-1-page-1",
      ...snapshot,
      createdAt: 1,
      updatedAt: 1,
      annotationSchemaVersion: 1,
    });
    const stored = await database.pageSnapshots.get("doc-1:doc-1-page-1");
    expect(stored?.annotations[0]?.rects).toEqual(rects);

    const hydrated = new EditorEngine();
    hydrated.setDocument("doc-1");
    hydrated.setActivePage("doc-1-page-1", { width: 600, height: 800 });
    if (stored === undefined) throw new Error("Expected stored snapshot.");
    hydrated.hydratePage(stored);
    expect(hydrated.exportPageSnapshot("doc-1-page-1").annotations[0]?.rects)
      .toEqual(rects);
  });
});

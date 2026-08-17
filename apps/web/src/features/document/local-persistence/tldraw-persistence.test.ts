import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEditorPersistence } from "./application/local-editor-persistence";
import { openLocalDatabase } from "./database";

const databaseNames = new Set<string>();

afterEach(async () => {
  for (const name of databaseNames) {
    const database = await openLocalDatabase({ databaseName: name });
    database.close();
    await Dexie.delete(name);
  }
  databaseNames.clear();
});

describe("tldraw local persistence", () => {
  it("stores a versioned TLStore snapshot in the existing pageSnapshots record", async () => {
    const name = `tldraw-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const database = await openLocalDatabase({ databaseName: name });
    const persistence = new LocalEditorPersistence({ databaseName: name });
    const tldrawSnapshot = {
      document: {
        store: {
          "shape:note-1": {
            id: "shape:note-1",
            typeName: "shape",
            type: "text",
            x: 120,
            y: 240,
            meta: { noteCreatedByTurnId: "turn-1" },
          },
        },
        schema: { schemaVersion: 2, sequences: {} },
      },
      session: {},
    };

    await persistence.saveTldrawPageSnapshot({
      documentId: "doc-1",
      pageId: "doc-1-page-1",
      pageNumber: 1,
      snapshot: tldrawSnapshot,
      annotations: [],
    });
    const restored = await persistence.getPageSnapshot("doc-1", "doc-1-page-1");

    expect(restored).toMatchObject({
      id: "doc-1:doc-1-page-1",
      documentId: "doc-1",
      pageId: "doc-1-page-1",
      revision: 1,
      tldrawCanvasStoreVersion: 1,
      tldrawSnapshot,
    });
    expect(database.table("pageSnapshots")).toBeDefined();
    expect(database.tables.some((table) => table.name !== "pageSnapshots"
      && table.name.toLowerCase().includes("tldraw"))).toBe(false);
  });
});

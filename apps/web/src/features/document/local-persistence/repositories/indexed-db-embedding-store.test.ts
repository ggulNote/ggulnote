import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { GgulnoteLocalDatabase, openLocalDatabase } from "../database";
import { EMBEDDING_DATABASE_VERSION } from "../types";
import { IndexedDbEmbeddingStore } from "./indexed-db-embedding-store";
import type { EmbeddingRecord } from "../../embedding/embedding-types";

const databaseNames = new Set<string>();

afterEach(async () => {
  for (const name of databaseNames) {
    const db = await openLocalDatabase({ databaseName: name });
    db.close();
    await Dexie.delete(name);
  }
  databaseNames.clear();
});

describe("IndexedDbEmbeddingStore", () => {
  it("round-trips Float32Array records and filters page/granularity", async () => {
    const name = databaseName();
    const store = new IndexedDbEmbeddingStore({ databaseName: name });
    await store.putMany([
      record("page-1", "sentence-1", "sentence", [0.25, 0.75]),
      record("page-1", "paragraph-1", "paragraph", [1, 0]),
      record("page-2", "sentence-2", "sentence", [0, 1]),
    ]);

    const exact = await store.getBySource("doc-1", "sentence-1", "sentence");
    expect(exact?.vector).toBeInstanceOf(Float32Array);
    expect(Array.from(exact?.vector ?? [])).toEqual([0.25, 0.75]);
    expect(await store.getByPage("doc-1", "page-1", "sentence")).toHaveLength(1);
    expect(await store.getByPage("doc-1", "page-1")).toHaveLength(2);

    await store.deleteBySource("doc-1", "sentence-1");
    expect(await store.getBySource("doc-1", "sentence-1")).toBeNull();
    await store.deleteByDocument("doc-1");
    expect(await store.getByPage("doc-1", "page-2")).toEqual([]);
  });

  it("migrates v2 without deleting existing document data", async () => {
    const name = databaseName();
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      documents: "&id, kind, updatedAt, lastOpenedAt, persistenceSchemaVersion",
      semanticPages: "&id, documentId, pageId, [documentId+pageId], extractorVersion, updatedAt",
    });
    await legacy.open();
    await legacy.table("documents").put({
      id: "doc-1",
      kind: "blank",
      name: "Existing note",
      pageCount: 1,
      currentPage: 1,
      zoom: 100,
      zoomMode: "custom",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      nextOperationSequence: 0,
      persistenceSchemaVersion: 1,
    });
    legacy.close();

    const migrated = new GgulnoteLocalDatabase(name);
    await migrated.open();
    expect(migrated.verno).toBe(EMBEDDING_DATABASE_VERSION);
    expect(await migrated.documents.get("doc-1")).toMatchObject({ name: "Existing note" });
    expect(migrated.tables.map((table) => table.name)).toContain("embeddings");
    migrated.close();
  });
});

function databaseName(): string {
  const name = `ggulnote-embedding-test-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

function record(
  pageId: string,
  sourceObjectId: string,
  granularity: EmbeddingRecord["granularity"],
  vector: readonly number[],
): EmbeddingRecord {
  return {
    id: `${pageId}:${granularity}:${sourceObjectId}`,
    documentId: "doc-1",
    pageId,
    sourceType: "pdf",
    sourceObjectId,
    sourceRevision: 1,
    granularity,
    contentHash: "hash",
    embeddingModel: "model-a",
    dimensions: 2,
    vector: new Float32Array(vector),
    createdAt: 1,
  };
}

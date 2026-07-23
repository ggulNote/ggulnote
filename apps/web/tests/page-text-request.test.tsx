import { describe, expect, it } from "vitest";
import {
  createPageTextCacheKey,
  isPageTextResultForPage,
  isSamePageTextRequest,
  type PageTextRequestIdentity,
} from "../src/features/document/text/page-text-request";
import type { PageTextContent } from "../src/features/document/model/document-types";
import {
  createSemanticPageId,
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_SCHEMA_VERSION,
  type PersistedSemanticPageRecord,
} from "../src/features/document/local-persistence/types";
import { isSemanticPageRecordCompatible } from "../src/features/document/local-persistence/repositories/semantic-page-repository";

const identity = (documentId: string, pageNumber: number, requestId: number): PageTextRequestIdentity => ({
  documentId,
  pageId: `${documentId}-page-${pageNumber}`,
  pageNumber,
  requestId,
});

describe("page-scoped Text Item requests", () => {
  it("rejects a late page 1 result after page 2 became current", () => {
    const pageOne = identity("doc", 1, 1);
    const pageTwo = identity("doc", 2, 2);
    expect(isSamePageTextRequest(pageOne, pageTwo)).toBe(false);
    expect(isSamePageTextRequest(pageTwo, pageTwo)).toBe(true);
  });

  it("keeps rapid 1-2-3-1 transitions request-scoped", () => {
    expect(isSamePageTextRequest(identity("doc", 1, 1), identity("doc", 1, 4))).toBe(false);
  });

  it("does not collide for the same page number in different documents", () => {
    expect(createPageTextCacheKey("doc-a", "doc-a-page-1")).not.toBe(createPageTextCacheKey("doc-b", "doc-b-page-1"));
    expect(createSemanticPageId("doc-a", "doc-a-page-1")).not.toBe(createSemanticPageId("doc-b", "doc-b-page-1"));
  });

  it("selects only the result bound to the rendered document and page", () => {
    const result = { documentId: "doc-a", pageId: "doc-a-page-2" } as PageTextContent;
    expect(isPageTextResultForPage(result, "doc-a", "doc-a-page-2")).toBe(true);
    expect(isPageTextResultForPage(result, "doc-a", "doc-a-page-1")).toBe(false);
    expect(isPageTextResultForPage(result, "doc-b", "doc-b-page-2")).toBe(false);
  });

  it("invalidates previous geometry caches with extractor version 4", () => {
    expect(SEMANTIC_EXTRACTOR_VERSION).toBe("4");
  });

  it("rejects cache records whose model document or page identity differs", () => {
    const record = {
      documentId: "doc-a",
      pageId: "doc-a-page-2",
      extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
      semanticSchemaVersion: SEMANTIC_SCHEMA_VERSION,
      model: {
        documentId: "doc-a",
        pageId: "doc-a-page-2",
        extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
        schemaVersion: SEMANTIC_SCHEMA_VERSION,
      },
    } as PersistedSemanticPageRecord;
    expect(isSemanticPageRecordCompatible(
      record,
      "doc-a",
      "doc-a-page-2",
      SEMANTIC_EXTRACTOR_VERSION,
      SEMANTIC_SCHEMA_VERSION,
    )).toBe(true);
    expect(isSemanticPageRecordCompatible(
      { ...record, model: { ...record.model, pageId: "doc-a-page-1" } },
      "doc-a",
      "doc-a-page-2",
      SEMANTIC_EXTRACTOR_VERSION,
      SEMANTIC_SCHEMA_VERSION,
    )).toBe(false);
    expect(isSemanticPageRecordCompatible(
      record,
      "doc-b",
      "doc-b-page-2",
      SEMANTIC_EXTRACTOR_VERSION,
      SEMANTIC_SCHEMA_VERSION,
    )).toBe(false);
  });
});
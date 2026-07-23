import type { PageTextContent } from "../model/document-types";

export interface PageTextRequestIdentity {
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
}

export function createPageTextCacheKey(documentId: string, pageId: string): string {
  return `${documentId.length}:${documentId}:${pageId.length}:${pageId}`;
}

export function isSamePageTextRequest(
  left: PageTextRequestIdentity | null,
  right: PageTextRequestIdentity | null,
): boolean {
  return Boolean(
    left
    && right
    && left.documentId === right.documentId
    && left.pageId === right.pageId
    && left.pageNumber === right.pageNumber
    && left.requestId === right.requestId,
  );
}

export function isPageTextResultForPage(
  result: PageTextContent | null,
  documentId: string | null,
  pageId: string | null,
): result is PageTextContent {
  return Boolean(
    result
    && documentId
    && pageId
    && result.documentId === documentId
    && result.pageId === pageId,
  );
}
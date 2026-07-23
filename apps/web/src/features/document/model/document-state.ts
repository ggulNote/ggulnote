import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import { A4_PORTRAIT_POINTS } from "./document-types";

export type SemanticPageStatus = "idle" | "processing" | "ready" | "empty" | "error";
export type SemanticCacheStatus = "idle" | "hit" | "miss" | "stale" | "error" | "disabled";
export type SemanticCandidateType = "WORD" | "LINE" | "SENTENCE" | "PARAGRAPH" | "NONE";

type PersistenceSaveStatus = "idle" | "saving" | "saved" | "error";

export type DocumentSessionAction =
  | { type: "LOAD_STARTED" }
  | { type: "PDF_LOADED"; document: DocumentDescriptor; pageCount: number }
  | { type: "BLANK_CREATED"; document: DocumentDescriptor; pageCount: number }
  | { type: "LOAD_FAILED"; message: string }
  | { type: "GO_TO_PAGE"; page: number }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_ZOOM_MODE"; mode: "custom" | "fit-width" }
  | {
      type: "PAGE_RENDERED";
      page: PageDescriptor;
      renderedWidth: number;
      renderedHeight: number;
    }
  | { type: "TEXT_EXTRACTED"; count: number }
  | { type: "TEXT_EXTRACTION_FAILED" }
  | { type: "POINTER_CHANGED"; point: NormalizedPoint | null }
  | { type: "DOCUMENT_CLOSED" }
  | { type: "PDFJS_READY"; loaded: boolean; workerReady: boolean }
  | { type: "TEXT_LOADING"; loading: boolean }
  | {
      type: "PERSISTENCE_STATUS_CHANGED";
      status: PersistenceSaveStatus;
      errorMessage: string | null;
    }
  | {
      type: "SEMANTIC_STATUS_UPDATED";
      status: SemanticPageStatus;
      cacheStatus: SemanticCacheStatus;
      sourceItemCount: number;
      wordCount: number;
      lineCount: number;
      sentenceCount: number;
      paragraphCount: number;
      regionCount?: number;
      blockCount?: number;
      columnCount: number;
      processingDurationMs: number;
      extractorVersion: string;
      schemaVersion: number;
      cacheMessage?: string | null;
    }
  | {
      type: "SEMANTIC_QUERY_UPDATED";
      selectedType: SemanticCandidateType;
      selectedId: string;
      selectedText: string;
      selectedBounds: NormalizedRect | null;
      candidateCount: number;
      nearestDistance: number | null;
    }
  | { type: "SEMANTIC_CLEAR_QUERY" };

export interface DocumentSessionState {
  status: "empty" | "loading" | "ready" | "error";
  document: DocumentDescriptor | null;
  currentPage: number;
  zoom: number;
  zoomMode: "custom" | "fit-width";
  page: PageDescriptor | null;
  textItemCount: number;
  pointer: NormalizedPoint | null;
  errorMessage: string | null;
  totalPages: number;
  isPdfJsReady: boolean;
  isPdfWorkerReady: boolean;
  renderedWidth: number;
  renderedHeight: number;
  isTextLoading: boolean;
  persistenceSaveStatus: PersistenceSaveStatus;
  persistenceSaveErrorMessage: string | null;

  semanticStatus: SemanticPageStatus;
  semanticCacheStatus: SemanticCacheStatus;
  semanticExtractorVersion: string;
  semanticSchemaVersion: number;
  semanticSourceItemCount: number;
  semanticWordCount: number;
  semanticLineCount: number;
  semanticSentenceCount: number;
  semanticParagraphCount: number;
  semanticRegionCount: number;
  semanticBlockCount: number;
  semanticColumnCount: number;
  semanticProcessingDurationMs: number;
  semanticSelectedType: SemanticCandidateType;
  semanticSelectedId: string;
  semanticSelectedText: string;
  semanticSelectedBounds: NormalizedRect | null;
  semanticCandidateCount: number;
  semanticNearestDistance: number | null;
}

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;

const clampPage = (page: number, totalPages: number): number => {
  if (!Number.isInteger(totalPages) || totalPages <= 0) {
    return 1;
  }

  const numericPage = Number.isFinite(page) ? Math.trunc(page) : 1;

  if (numericPage < 1) {
    return 1;
  }

  if (numericPage > totalPages) {
    return totalPages;
  }

  return numericPage;
};

const resetSemanticState = (): Pick<
  DocumentSessionState,
  | "semanticStatus"
  | "semanticCacheStatus"
  | "semanticExtractorVersion"
  | "semanticSchemaVersion"
  | "semanticSourceItemCount"
  | "semanticWordCount"
  | "semanticLineCount"
  | "semanticSentenceCount"
  | "semanticParagraphCount"
  | "semanticRegionCount"
  | "semanticBlockCount"
  | "semanticColumnCount"
  | "semanticProcessingDurationMs"
  | "semanticSelectedType"
  | "semanticSelectedId"
  | "semanticSelectedText"
  | "semanticSelectedBounds"
  | "semanticCandidateCount"
  | "semanticNearestDistance"
> => ({
  semanticStatus: "idle",
  semanticCacheStatus: "idle",
  semanticExtractorVersion: "1",
  semanticSchemaVersion: 1,
  semanticSourceItemCount: 0,
  semanticWordCount: 0,
  semanticLineCount: 0,
  semanticSentenceCount: 0,
  semanticParagraphCount: 0,
  semanticRegionCount: 0,
  semanticBlockCount: 0,
  semanticColumnCount: 0,
  semanticProcessingDurationMs: 0,
  semanticSelectedType: "NONE",
  semanticSelectedId: "-",
  semanticSelectedText: "-",
  semanticSelectedBounds: null,
  semanticCandidateCount: 0,
  semanticNearestDistance: null,
});

export const getInitialDocumentSessionState = (): DocumentSessionState => ({
  status: "empty",
  document: null,
  currentPage: 1,
  zoom: 100,
  zoomMode: "custom",
  page: null,
  textItemCount: 0,
  pointer: null,
  errorMessage: null,
  totalPages: 0,
  isPdfJsReady: false,
  isPdfWorkerReady: false,
  renderedWidth: 0,
  renderedHeight: 0,
  isTextLoading: false,
  persistenceSaveStatus: "idle",
  persistenceSaveErrorMessage: null,
  ...resetSemanticState(),
});

export function documentSessionReducer(
  state: DocumentSessionState,
  action: DocumentSessionAction,
): DocumentSessionState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
        status: "loading",
        errorMessage: null,
        textItemCount: 0,
        renderedWidth: 0,
        renderedHeight: 0,
        page: null,
        isTextLoading: false,
        ...resetSemanticState(),
      };

    case "PDF_LOADED":
      return {
        ...state,
        status: "ready",
        document: action.document,
        totalPages: action.pageCount,
        currentPage: clampPage(1, action.pageCount),
        page: null,
        textItemCount: 0,
        errorMessage: null,
        renderedWidth: 0,
        renderedHeight: 0,
        ...resetSemanticState(),
      };

    case "BLANK_CREATED": {
      const totalPages = action.pageCount;
      return {
        ...state,
        status: "ready",
        document: action.document,
        totalPages,
        currentPage: clampPage(1, totalPages),
        page: {
          id: `${action.document.id}-page-1`,
          pageNumber: 1,
          width: A4_PORTRAIT_POINTS.width,
          height: A4_PORTRAIT_POINTS.height,
          rotation: 0,
        },
        textItemCount: 0,
        errorMessage: null,
        ...resetSemanticState(),
      };
    }

    case "LOAD_FAILED":
      return {
        ...state,
        status: "error",
        errorMessage: action.message,
        document: null,
        currentPage: 1,
        totalPages: 0,
        page: null,
        renderedWidth: 0,
        renderedHeight: 0,
        textItemCount: 0,
        isTextLoading: false,
        ...resetSemanticState(),
      };

    case "GO_TO_PAGE": {
      const nextPage = clampPage(action.page, state.totalPages);
      if (nextPage === state.currentPage) {
        return state;
      }

      return {
        ...state,
        currentPage: nextPage,
        page: null,
        renderedWidth: 0,
        renderedHeight: 0,
        ...resetSemanticState(),
      };
    }

    case "SET_ZOOM":
      return {
        ...state,
        zoom: clampZoom(action.zoom),
        zoomMode: "custom",
      };

    case "SET_ZOOM_MODE":
      return {
        ...state,
        zoomMode: action.mode,
      };

    case "PAGE_RENDERED":
      return {
        ...state,
        page: action.page,
        renderedWidth: action.renderedWidth,
        renderedHeight: action.renderedHeight,
      };

    case "TEXT_EXTRACTED":
      return {
        ...state,
        textItemCount: action.count,
        isTextLoading: false,
      };

    case "TEXT_EXTRACTION_FAILED":
      return {
        ...state,
        textItemCount: 0,
        isTextLoading: false,
      };

    case "TEXT_LOADING":
      return {
        ...state,
        isTextLoading: action.loading,
      };

    case "PERSISTENCE_STATUS_CHANGED":
      return {
        ...state,
        persistenceSaveStatus: action.status,
        persistenceSaveErrorMessage: action.errorMessage,
      };

    case "POINTER_CHANGED":
      return {
        ...state,
        pointer: action.point,
      };

    case "SEMANTIC_STATUS_UPDATED":
      return {
        ...state,
        semanticStatus: action.status,
        semanticCacheStatus: action.cacheStatus,
        semanticSourceItemCount: action.sourceItemCount,
        semanticWordCount: action.wordCount,
        semanticLineCount: action.lineCount,
        semanticSentenceCount: action.sentenceCount,
        semanticParagraphCount: action.paragraphCount,
        semanticRegionCount: action.regionCount ?? 0,
        semanticBlockCount: action.blockCount ?? 0,
        semanticColumnCount: action.columnCount,
        semanticProcessingDurationMs: action.processingDurationMs,
        semanticExtractorVersion: action.extractorVersion,
        semanticSchemaVersion: action.schemaVersion,
      };

    case "SEMANTIC_QUERY_UPDATED":
      return {
        ...state,
        semanticSelectedType: action.selectedType,
        semanticSelectedId: action.selectedId,
        semanticSelectedText: action.selectedText,
        semanticSelectedBounds: action.selectedBounds,
        semanticCandidateCount: action.candidateCount,
        semanticNearestDistance: action.nearestDistance,
      };

    case "SEMANTIC_CLEAR_QUERY":
      return {
        ...state,
        semanticSelectedType: "NONE",
        semanticSelectedId: "-",
        semanticSelectedText: "-",
        semanticSelectedBounds: null,
        semanticCandidateCount: 0,
        semanticNearestDistance: null,
      };

    case "DOCUMENT_CLOSED":
      return getInitialDocumentSessionState();

    case "PDFJS_READY":
      return {
        ...state,
        isPdfJsReady: action.loaded,
        isPdfWorkerReady: action.workerReady,
      };

    default:
      return state;
  }
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
}

type DocumentDescriptor = {
  id: string;
  kind: "pdf" | "blank";
  name: string;
  pageCount: number;
};

type PageDescriptor = {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
};

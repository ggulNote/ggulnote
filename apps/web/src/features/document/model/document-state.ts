import type { NormalizedPoint, PageDescriptor, DocumentDescriptor } from "./document-types";
import { A4_PORTRAIT_POINTS } from "./document-types";

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
    };

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

const clampZoom = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
};

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

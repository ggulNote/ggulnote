import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { type BlankDocumentDescriptor, type PdfDocumentDescriptor, type PageTextContent } from "../model/document-types";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  documentSessionReducer,
  getInitialDocumentSessionState,
} from "../model/document-reducer";
import { usePdfDocument } from "./use-pdf-document";
import { ensurePdfJsInitialized } from "../adapters/pdfjs/pdfjs-loader";
import { validatePdfFile } from "../validation/validate-pdf-file";
import { extractPageTextContent } from "../text/extract-page-text";

const clampZoom = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
};

export function useDocumentSession() {
  const [state, dispatch] = useReducer(documentSessionReducer, getInitialDocumentSessionState());
  const { open, close, getPage } = usePdfDocument();
  const textCacheRef = useRef<Map<number, PageTextContent>>(new Map());
  const requestTokenRef = useRef(0);

  const openPdfFile = useCallback(
    async (file: File | null): Promise<void> => {
      const validation = validatePdfFile(file);
      if (!validation.ok) {
        dispatch({ type: "LOAD_FAILED", message: validation.message });
        return;
      }

      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;
      dispatch({ type: "LOAD_STARTED" });

      try {
        const pdfjsLib = await ensurePdfJsInitialized();
        dispatch({ type: "PDFJS_READY", loaded: true, workerReady: Boolean(pdfjsLib.GlobalWorkerOptions.workerSrc) });

        const arrayBuffer = await validation.file.arrayBuffer();
        const openResult = await open(new Uint8Array(arrayBuffer));

        if (requestTokenRef.current !== token) {
          return;
        }

        const descriptor: PdfDocumentDescriptor = {
          id: `pdf-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
          kind: "pdf",
          name: validation.file.name,
          pageCount: openResult.pdfDocument.numPages,
          fileSize: validation.file.size,
        };

        textCacheRef.current.clear();
        dispatch({ type: "PDF_LOADED", document: descriptor, pageCount: descriptor.pageCount });
      } catch (error) {
        const message = error instanceof Error ? error.message : "PDF 파일을 열지 못했습니다.";
        dispatch({ type: "LOAD_FAILED", message });
      }
    },
    [open],
  );

  const openBlankDocument = useCallback(() => {
    void close();
    requestTokenRef.current += 1;
    dispatch({
      type: "BLANK_CREATED",
      document: {
        id: `blank-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
        kind: "blank",
        name: "새 백지",
        pageCount: 1,
      } as BlankDocumentDescriptor,
      pageCount: 1,
    });
    textCacheRef.current.clear();
  }, [close]);

  const closeDocument = useCallback(async (): Promise<void> => {
    requestTokenRef.current += 1;
    textCacheRef.current.clear();
    await close();
    dispatch({ type: "DOCUMENT_CLOSED" });
  }, [close]);

  const goToPage = useCallback((page: number): void => {
    dispatch({ type: "GO_TO_PAGE", page });
  }, []);

  const setZoom = useCallback((zoom: number): void => {
    dispatch({ type: "SET_ZOOM", zoom: clampZoom(zoom) });
  }, []);

  const setZoomMode = useCallback((mode: "custom" | "fit-width"): void => {
    dispatch({ type: "SET_ZOOM_MODE", mode });
  }, []);

  const setPointer = useCallback((point: { x: number; y: number } | null): void => {
    dispatch({ type: "POINTER_CHANGED", point });
  }, []);

  const requestPageText = useCallback(
    async (page: PDFPageProxy, pageNumber: number, pageSize: { width: number; height: number }) => {
      const cached = textCacheRef.current.get(pageNumber);
      if (cached) {
        dispatch({ type: "TEXT_EXTRACTED", count: cached.items.length });
        return;
      }

      dispatch({ type: "TEXT_LOADING", loading: true });
      try {
        const content = await extractPageTextContent(page, pageNumber, pageSize);
        textCacheRef.current.set(pageNumber, content);
        dispatch({ type: "TEXT_EXTRACTED", count: content.items.length });
      } catch {
        dispatch({ type: "TEXT_EXTRACTION_FAILED" });
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      void close();
    };
  }, [close]);

  return {
    state,
    openPdfFile,
    openBlankDocument,
    closeDocument,
    goToPage,
    setZoom,
    setZoomMode,
    setPointer,
    requestPageText,
    getPage,
    dispatch,
    document: state.document,
  };
}

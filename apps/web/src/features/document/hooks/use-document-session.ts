import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { BlankDocumentDescriptor, PdfDocumentDescriptor, PageTextContent } from "../model/document-types";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  documentSessionReducer,
  getInitialDocumentSessionState,
} from "../model/document-state";
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

  const openPdfByArrayBuffer = useCallback(
    async (
      document: PdfDocumentDescriptor,
      arrayBuffer: ArrayBuffer,
    ): Promise<PdfDocumentDescriptor | null> => {
      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;
      dispatch({ type: "LOAD_STARTED" });

      try {
        const pdfjsLib = await ensurePdfJsInitialized();
        dispatch({ type: "PDFJS_READY", loaded: true, workerReady: Boolean(pdfjsLib.GlobalWorkerOptions.workerSrc) });

        const handle = await open(new Uint8Array(arrayBuffer));
        const opened: PdfDocumentDescriptor = {
          ...document,
          pageCount: handle.pdfDocument.numPages,
        };

        if (requestTokenRef.current !== token) {
          return null;
        }

        dispatch({ type: "PDF_LOADED", document: opened, pageCount: opened.pageCount });
        return opened;
      } catch (error) {
        const message = error instanceof Error ? error.message : "PDF 파일을 열지 못했습니다.";
        dispatch({ type: "LOAD_FAILED", message });
        return null;
      }
    },
    [open],
  );

  const openPdfFile = useCallback(
    async (file: File | null): Promise<PdfDocumentDescriptor | null> => {
      const validation = validatePdfFile(file);
      if (!validation.ok) {
        dispatch({ type: "LOAD_FAILED", message: validation.message });
        return null;
      }

      const arrayBuffer = await validation.file.arrayBuffer();
      const descriptor: PdfDocumentDescriptor = {
        id: `pdf-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
        kind: "pdf",
        name: validation.file.name,
        pageCount: 1,
        fileSize: validation.file.size,
      };

      const opened = await openPdfByArrayBuffer(descriptor, arrayBuffer);
      if (!opened) {
        return null;
      }

      textCacheRef.current.clear();
      return opened;
    },
    [openPdfByArrayBuffer],
  );

  const openPersistedPdfDocument = useCallback(
    async (document: PdfDocumentDescriptor, file: Blob): Promise<PdfDocumentDescriptor | null> => {
      const arrayBuffer = await file.arrayBuffer();
      return openPdfByArrayBuffer(document, arrayBuffer);
    },
    [openPdfByArrayBuffer],
  );

  const openBlankDocument = useCallback((document?: BlankDocumentDescriptor): BlankDocumentDescriptor => {
    requestTokenRef.current += 1;
    const nextDocument: BlankDocumentDescriptor =
      document ?? {
        id: `blank-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
        kind: "blank",
        name: "새 백지",
        pageCount: 1,
      };

    dispatch({
      type: "BLANK_CREATED",
      document: nextDocument,
      pageCount: nextDocument.pageCount,
    });
    textCacheRef.current.clear();
    return nextDocument;
  }, []);

  const openBlankFromDescriptor = useCallback(
    (document: BlankDocumentDescriptor): BlankDocumentDescriptor =>
      openBlankDocument(document),
    [openBlankDocument],
  );

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
    async (page: PDFPageProxy, pageNumber: number, pageSize: { width: number; height: number }): Promise<PageTextContent | null> => {
      const cached = textCacheRef.current.get(pageNumber);
      if (cached) {
        dispatch({ type: "TEXT_EXTRACTED", count: cached.items.length });
        return cached;
      }

      dispatch({ type: "TEXT_LOADING", loading: true });
      try {
        const content = await extractPageTextContent(page, pageNumber, pageSize);
        textCacheRef.current.set(pageNumber, content);
        dispatch({ type: "TEXT_EXTRACTED", count: content.items.length });
        return content;
      } catch {
        dispatch({ type: "TEXT_EXTRACTION_FAILED" });
        return null;
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
    openPersistedPdfDocument,
    openBlankDocument,
    openBlankFromDescriptor,
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

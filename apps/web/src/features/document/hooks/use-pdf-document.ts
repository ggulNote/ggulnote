import { useCallback, useRef } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { PdfDocumentHandle } from "../adapters/pdfjs/pdf-document-adapter";
import { closePdfDocument, getPdfPage, openPdfDocument } from "../adapters/pdfjs/pdf-document-adapter";

export function usePdfDocument() {
  const handleRef = useRef<PdfDocumentHandle | null>(null);

  const open = useCallback(async (data: Uint8Array): Promise<PdfDocumentHandle> => {
    if (handleRef.current) {
      await closePdfDocument(handleRef.current);
      handleRef.current = null;
    }

    const handle = await openPdfDocument(data);
    handleRef.current = handle;
    return handle;
  }, []);

  const close = useCallback(async (): Promise<void> => {
    if (handleRef.current) {
      await closePdfDocument(handleRef.current);
      handleRef.current = null;
    }
  }, []);

  const getPage = useCallback(async (pageNumber: number): Promise<PDFPageProxy> => {
    if (!handleRef.current) {
      throw new Error("문서가 로드되어 있지 않습니다.");
    }

    return getPdfPage(handleRef.current.pdfDocument, pageNumber);
  }, []);

  return { open, close, getPage };
}

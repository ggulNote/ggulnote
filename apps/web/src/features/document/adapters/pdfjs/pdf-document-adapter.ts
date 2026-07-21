import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";

import { ensurePdfJsInitialized } from "./pdfjs-loader";

export type PdfDocumentHandle = {
  loadingTask: PDFDocumentLoadingTask;
  pdfDocument: PDFDocumentProxy;
};

export async function openPdfDocument(data: Uint8Array): Promise<PdfDocumentHandle> {
  const pdfjsLib = await ensurePdfJsInitialized();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;
  return { loadingTask, pdfDocument };
}

export async function getPdfPage(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
): Promise<PDFPageProxy> {
  return pdfDocument.getPage(pageNumber);
}

export async function closePdfDocument(handle: PdfDocumentHandle | null): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    await handle.loadingTask.destroy();
  } catch {
    // Ignore cleanup errors.
  }

  try {
    await handle.pdfDocument.cleanup(true);
  } catch {
    // Ignore cleanup errors.
  }
}

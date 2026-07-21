type PdfJsLib = typeof import("pdfjs-dist");

let pdfjsLib: PdfJsLib | null = null;
let initializePromise: Promise<PdfJsLib> | null = null;

export async function ensurePdfJsInitialized(): Promise<PdfJsLib> {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = import("pdfjs-dist")
    .then((library) => {
      const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
      library.GlobalWorkerOptions.workerSrc = workerUrl;
      pdfjsLib = library;
      return library;
    })
    .catch((error) => {
      initializePromise = null;
      throw error;
    });

  return initializePromise;
}

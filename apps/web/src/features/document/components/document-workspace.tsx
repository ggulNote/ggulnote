"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientPointToNormalized } from "../coordinates/coordinate-transformer";
import { useDocumentSession } from "../hooks/use-document-session";
import { useFitWidth } from "../hooks/use-fit-width";
import { usePageRender } from "../hooks/use-page-render";
import { DocumentDebugPanel } from "./document-debug-panel";
import { DocumentSidebar } from "./document-sidebar";
import { DocumentStage } from "./document-stage";
import { DocumentToolbar } from "./document-toolbar";

const ZOOM_STEP = 25;

type FitDimensions = {
  width: number;
  height: number;
};

export function DocumentWorkspace(): React.ReactElement {
  const {
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
    document,
  } = useDocumentSession();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pageProxy, setPageProxy] = useState<import("pdfjs-dist/types/src/display/api").PDFPageProxy | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const pageRequestTokenRef = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stageElementRef = useRef<HTMLDivElement | null>(null);

  const canGoPrevious = state.currentPage > 1 && state.totalPages > 1;
  const canGoNext = state.currentPage < state.totalPages;
  const documentName = useMemo(() => state.document?.name ?? "-", [state.document?.name]);
  const isPdfReady = state.document?.kind === "pdf" && state.status === "ready";

  const fitWidthTargetPageWidth = useMemo(() => {
    if (state.document?.kind === "blank") {
      return 595.28;
    }

    return state.page?.width ?? 0;
  }, [state.document?.kind, state.page?.width]);

  const stageSize = useMemo<FitDimensions>(() => {
    const width = state.renderedWidth > 0 ? state.renderedWidth : state.page?.width ?? 0;
    const height = state.renderedHeight > 0 ? state.renderedHeight : state.page?.height ?? 0;
    return {
      width,
      height,
    };
  }, [state.page?.width, state.page?.height, state.renderedHeight, state.renderedWidth]);

  useFitWidth({
    enabled: state.zoomMode === "fit-width" && state.status === "ready" && fitWidthTargetPageWidth > 0,
    containerWidth,
    pageWidth: fitWidthTargetPageWidth,
    onFitZoom: (zoom) => {
      setZoom(zoom);
    },
  });

  const handleOpenPdf = useCallback(
    async (file: File | null) => {
      await openPdfFile(file);
    },
    [openPdfFile],
  );

  const handleCreateBlank = useCallback(() => {
    openBlankDocument();
  }, [openBlankDocument]);

  const handlePageSubmit = useCallback(
    (nextPage: number) => {
      goToPage(nextPage);
    },
    [goToPage],
  );

  const fitWidth = useCallback(() => {
    setZoomMode("fit-width");
    if (fitWidthTargetPageWidth > 0 && containerWidth > 0) {
      const next = Math.round((containerWidth / fitWidthTargetPageWidth) * 100);
      setZoom(next);
    }
  }, [setZoom, setZoomMode, containerWidth, fitWidthTargetPageWidth]);

  const stageRef = useCallback(
    (element: HTMLDivElement | null) => {
      stageElementRef.current = element;

      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (!element) {
        setContainerWidth(0);
        return;
      }

      setContainerWidth(element.clientWidth);
      observerRef.current = new ResizeObserver(() => {
        setContainerWidth(element.clientWidth);
      });
      observerRef.current.observe(element);
    },
    [setContainerWidth],
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isPdfReady) {
      return;
    }

    const token = pageRequestTokenRef.current + 1;
    pageRequestTokenRef.current = token;

    const loadPage = async () => {
      try {
        const page = await getPage(state.currentPage);
        if (pageRequestTokenRef.current === token && state.status === "ready") {
          setPageProxy(page);
        }
      } catch {
        if (pageRequestTokenRef.current === token) {
          dispatch({ type: "LOAD_FAILED", message: "페이지를 가져오지 못했습니다." });
        }
      }
    };

    void loadPage();
  }, [dispatch, getPage, isPdfReady, state.currentPage, state.status]);

  usePageRender({
    canvas,
    page: pageProxy,
    zoom: state.zoom,
    onRendered: ({ width, height, renderedWidth, renderedHeight }) => {
      if (!pageProxy || !state.document) {
        return;
      }

      dispatch({
        type: "PAGE_RENDERED",
        page: {
          id: `${state.document.id}-page-${state.currentPage}`,
          pageNumber: state.currentPage,
          width,
          height,
          rotation: 0,
        },
        renderedWidth,
        renderedHeight,
      });

      void requestPageText(pageProxy, state.currentPage, {
        width,
        height,
      });
    },
    onError: (message) => {
      dispatch({ type: "LOAD_FAILED", message });
    },
  });

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointerTarget = stageElementRef.current;
      if (!pointerTarget) {
        return;
      }

      const rect = pointerTarget.getBoundingClientRect();
      const normalized = clientPointToNormalized(
        { x: event.clientX, y: event.clientY },
        {
          left: rect.left,
          top: rect.top,
          width: stageSize.width,
          height: stageSize.height,
        },
      );
      setPointer(normalized);
    },
    [setPointer, stageSize.width, stageSize.height],
  );

  const handlePointerLeave = useCallback(() => {
    setPointer(null);
  }, [setPointer]);

  const loadingMessage = useMemo(() => {
    if (state.status !== "loading") {
      return null;
    }

    if (!state.document) {
      return "PDF 문서를 처리하고 있습니다.";
    }

    return state.totalPages > 0
      ? `${state.currentPage} / ${state.totalPages} 페이지를 렌더링하고 있습니다.`
      : "문서를 읽고 있습니다.";
  }, [state.document, state.status, state.totalPages, state.currentPage]);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <header className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">꿀노트</h1>
            <p className="text-sm text-slate-600">PDF 및 백지 문서 뷰어</p>
          </div>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600">
            상태: {state.status}
          </span>
        </div>
      </header>

      <DocumentToolbar
        onOpenPdf={handleOpenPdf}
        onCreateBlank={handleCreateBlank}
        onClose={closeDocument}
        onPreviousPage={() => handlePageSubmit(state.currentPage - 1)}
        onNextPage={() => handlePageSubmit(state.currentPage + 1)}
        onSetPage={handlePageSubmit}
        onZoomIn={() => setZoom(state.zoom + ZOOM_STEP)}
        onZoomOut={() => setZoom(state.zoom - ZOOM_STEP)}
        onResetZoom={() => setZoom(100)}
        onFitWidth={fitWidth}
        status={state.status}
        currentPage={state.currentPage}
        totalPages={state.totalPages}
        zoom={state.zoom}
        canGoPrevious={canGoPrevious}
        canGoNext={canGoNext}
        disabledPageInput={state.status !== "ready"}
        canFitWidth={fitWidthTargetPageWidth > 0 && containerWidth > 0 && state.status === "ready"}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_280px]">
        <DocumentSidebar
          totalPages={state.totalPages}
          currentPage={state.currentPage}
          onMove={handlePageSubmit}
          disabled={state.status !== "ready" || !isPdfReady}
        />

        <DocumentStage
          state={state}
          mode={state.status}
          statusMessage={loadingMessage}
          canvasRef={setCanvas}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          stageRef={stageRef}
          pointer={state.pointer}
        />

        <DocumentDebugPanel state={state} documentName={documentName} pointer={state.pointer} />
      </div>
    </main>
  );
}

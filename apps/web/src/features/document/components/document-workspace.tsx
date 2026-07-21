"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NativeCanvasRenderer } from "../../editor/adapters/canvas/canvas-2d-renderer";
import { AnnotationCanvasLayer, type AnnotationCanvasHandle } from "../../editor/components/annotation-canvas-layer";
import { EditorDebugPanel } from "../../editor/components/editor-debug-panel";
import { EditorDevelopmentToolbar } from "../../editor/components/editor-development-toolbar";
import { DEFAULT_INTERACTION_MODE, type EditorInteractionMode } from "../../editor/interaction/interaction-mode";
import {
  EditorEngine,
  type CreateAnnotationInput,
  type SerializedAnnotation,
} from "@ggulnote/editor-core";
import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import { clientPointToNormalized } from "../coordinates/coordinate-transformer";
import { useDocumentSession } from "../hooks/use-document-session";
import { useFitWidth } from "../hooks/use-fit-width";
import { usePageRender } from "../hooks/use-page-render";
import { DocumentDebugPanel } from "./document-debug-panel";
import { DocumentSidebar } from "./document-sidebar";
import { DocumentStage } from "./document-stage";
import { DocumentToolbar } from "./document-toolbar";

const ZOOM_STEP = 25;

const DEFAULT_TEXT_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.2,
  height: 0.08,
};

const DEFAULT_UNDERLINE_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.2,
  height: 0.015,
};

const DEFAULT_SHAPE_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.22,
  height: 0.14,
};

type FitDimensions = {
  width: number;
  height: number;
};

type DragDraft =
  | {
      type: "move";
    }
  | {
      type: "shape";
      mode: "rectangle" | "ellipse";
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      type: "line";
      lineKind: "line" | "arrow";
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      type: "table";
      start: NormalizedPoint;
      end: NormalizedPoint;
    };

const clampTextInput = (value: number): number => {
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 1) {
    return 3;
  }

  return Math.min(20, Math.max(1, value));
};

function toRect(
  start: NormalizedPoint,
  end: NormalizedPoint,
  fallback: Omit<NormalizedRect, "x" | "y">,
): NormalizedRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.max(fallback.width, Math.abs(end.x - start.x));
  const height = Math.max(fallback.height, Math.abs(end.y - start.y));

  return {
    x,
    y,
    width,
    height,
  };
}

function getSnapshotPoint(
  event: React.PointerEvent<HTMLElement>,
  stageRef: React.RefObject<HTMLDivElement | null>,
): NormalizedPoint | null {
  const pointerTarget = stageRef.current;
  if (!pointerTarget) {
    return null;
  }

  const rect = pointerTarget.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return clientPointToNormalized(
    { x: event.clientX, y: event.clientY },
    {
      left: rect.left,
      top: rect.top,
      width,
      height,
    },
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || (target as HTMLElement).isContentEditable;
}

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
  } = useDocumentSession();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pageProxy, setPageProxy] = useState<import("pdfjs-dist/types/src/display/api").PDFPageProxy | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [interactionMode, setInteractionMode] = useState<EditorInteractionMode>(DEFAULT_INTERACTION_MODE);
  const [textMemo, setTextMemo] = useState("memo");
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);

  const [editorEngine] = useState(() => new EditorEngine());
  const annotationCanvasRef = useRef<AnnotationCanvasHandle | null>(null);
  const rendererRef = useRef(new NativeCanvasRenderer());
  const activeDragRef = useRef<DragDraft | null>(null);
  const renderFrameRef = useRef<number | null>(null);

  const pageRequestTokenRef = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stageElementRef = useRef<HTMLDivElement | null>(null);

  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    if (typeof window !== "object") {
      return;
    }

    const next = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    setDpr(next);
  }, [setDpr]);

  const editorSnapshot = useSyncExternalStore(
    useCallback((listener) => editorEngine.subscribe(listener), [editorEngine]),
    useCallback(() => editorEngine.getSnapshot(), [editorEngine]),
    useCallback(() => editorEngine.getSnapshot(), [editorEngine]),
  );

  const undoStackSize = editorEngine.getUndoStackSize();
  const redoStackSize = editorEngine.getRedoStackSize();

  const selectedSerializedAnnotation: SerializedAnnotation | null = editorSnapshot.selectedAnnotationId
    ? editorEngine.getSelectedAnnotationSnapshot()
    : null;

  const canGoPrevious = state.currentPage > 1 && state.totalPages > 1;
  const canGoNext = state.currentPage < state.totalPages;
  const documentName = useMemo(() => state.document?.name ?? "-", [state.document?.name]);
  const isPdfReady = state.document?.kind === "pdf" && state.status === "ready";
  const hasDocument = Boolean(state.document);

  const activePageId = state.document ? `${state.document.id}-page-${state.currentPage}` : null;

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

  useEffect(() => {
    if (state.document?.id) {
      editorEngine.setDocument(state.document.id);
    } else {
      editorEngine.setDocument(null);
    }
  }, [editorEngine, state.document?.id]);

  useEffect(() => {
    if (!activePageId) {
      editorEngine.setActivePage(null);
      return;
    }

    if (state.renderedWidth > 0 && state.renderedHeight > 0) {
      editorEngine.setActivePage(activePageId, {
        width: state.renderedWidth,
        height: state.renderedHeight,
      });
    } else if (stageSize.width > 0 && stageSize.height > 0) {
      editorEngine.setActivePage(activePageId, stageSize);
    } else {
      editorEngine.setActivePage(activePageId);
    }
  }, [activePageId, editorEngine, stageSize, state.renderedHeight, state.renderedWidth]);

  useEffect(() => {
    return () => {
      editorEngine.destroy();
    };
  }, [editorEngine]);

  const renderSchedule = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (renderFrameRef.current !== null) {
      return;
    }

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;

      const canvasRef = annotationCanvasRef.current?.getCanvas();
      if (!canvasRef || !stageSize.width || !stageSize.height) {
        return;
      }

      const renderer = rendererRef.current;
      renderer.setCanvas(canvasRef);
      renderer.setSize(stageSize.width, stageSize.height, dpr);
      try {
        editorEngine.render(renderer, dpr);
      } catch {
        return;
      }
    });
  }, [dpr, editorEngine, stageSize.height, stageSize.width]);

  useEffect(() => {
    renderSchedule();
  }, [editorSnapshot.revision, renderSchedule]);

  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
      }
    };
  }, []);

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
      if (typeof ResizeObserver !== "undefined") {
        observerRef.current = new ResizeObserver(() => {
          setContainerWidth(element.clientWidth);
        });
        observerRef.current.observe(element);
      }
    },
    [],
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
          dispatch({ type: "LOAD_FAILED", message: "?섏씠吏瑜?媛?몄삤吏 紐삵뻽?듬땲??" });
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

  const clampSize = useCallback(
    (point: NormalizedPoint): NormalizedPoint => ({
      x: Number.isFinite(point.x) ? Math.min(1, Math.max(0, point.x)) : 0,
      y: Number.isFinite(point.y) ? Math.min(1, Math.max(0, point.y)) : 0,
    }),
    [],
  );

  const createAnnotation = useCallback(
    (input: CreateAnnotationInput) => {
      if (!activePageId) {
        return;
      }

      try {
        editorEngine.createAnnotation(input);
        renderSchedule();
      } catch {
        // no-op
      }
    },
    [activePageId, editorEngine, renderSchedule],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const point = getSnapshotPoint(event, stageElementRef);
      if (!point || !activePageId) {
        return;
      }

      const currentDocumentId = state.document?.id;
      if (!currentDocumentId) {
        return;
      }

      if (editorEngine.getDocumentId() !== currentDocumentId) {
        editorEngine.setDocument(currentDocumentId);
      }

      if (editorEngine.getActivePageId() !== activePageId) {
        if (state.renderedWidth > 0 && state.renderedHeight > 0) {
          editorEngine.setActivePage(activePageId, {
            width: state.renderedWidth,
            height: state.renderedHeight,
          });
        } else if (stageSize.width > 0 && stageSize.height > 0) {
          editorEngine.setActivePage(activePageId, {
            width: stageSize.width,
            height: stageSize.height,
          });
        } else {
          editorEngine.setActivePage(activePageId);
        }
      }

      const normalized = clampSize(point);
      setPointer(normalized);

      switch (interactionMode) {
        case "select": {
          try {
            editorEngine.selectAt(normalized);
          } catch {
            return;
          }

          const mode: "move" | "resize" = editorEngine.isResizeHandle(normalized) ? "resize" : "move";
          const started = editorEngine.startDrag(normalized, mode);
          if (started) {
            activeDragRef.current = { type: "move" };
          }
          break;
        }
        case "text": {
          const bounds: NormalizedRect = {
            x: normalized.x,
            y: normalized.y,
            ...DEFAULT_TEXT_BOUNDS,
          };
          createAnnotation({
            type: "TEXT",
            pageId: activePageId,
            bounds,
            text: textMemo,
          });
          break;
        }
        case "underline": {
          const bounds: NormalizedRect = {
            x: normalized.x,
            y: normalized.y,
            ...DEFAULT_UNDERLINE_BOUNDS,
          };
          createAnnotation({
            type: "UNDERLINE",
            pageId: activePageId,
            bounds,
          });
          break;
        }
        case "highlight": {
          const bounds: NormalizedRect = {
            x: normalized.x,
            y: normalized.y,
            ...DEFAULT_TEXT_BOUNDS,
          };
          createAnnotation({
            type: "HIGHLIGHT",
            pageId: activePageId,
            bounds,
          });
          break;
        }
        case "rectangle":
        case "ellipse":
          activeDragRef.current = {
            type: "shape",
            mode: interactionMode,
            start: normalized,
            end: normalized,
          };
          break;
        case "line":
        case "arrow":
          activeDragRef.current = {
            type: "line",
            lineKind: interactionMode,
            start: normalized,
            end: normalized,
          };
          break;
        case "table":
          activeDragRef.current = {
            type: "table",
            start: normalized,
            end: normalized,
          };
          break;
        default:
          activeDragRef.current = null;
          break;
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // pointer capture unsupported in this environment
      }
    },
    [
      activePageId,
      clampSize,
      createAnnotation,
      editorEngine,
      interactionMode,
      setPointer,
      stageSize.height,
      stageSize.width,
      state.document?.id,
      state.renderedHeight,
      state.renderedWidth,
      textMemo,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const point = getSnapshotPoint(event, stageElementRef);
      if (!point) {
        return;
      }

      const normalized = clampSize(point);
      setPointer(normalized);

      const drag = activeDragRef.current;
      if (!drag) {
        return;
      }

      if (drag.type === "move") {
        editorEngine.moveDrag(normalized);
        renderSchedule();
        return;
      }

      activeDragRef.current = {
        ...drag,
        end: normalized,
      };
      renderSchedule();
    },
    [clampSize, editorEngine, renderSchedule, setPointer],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const point = getSnapshotPoint(event, stageElementRef);
      if (!activePageId) {
        activeDragRef.current = null;
        return;
      }

      const draft = activeDragRef.current;
      const clampedPoint = point ? clampSize(point) : null;
      const end = draft && "start" in draft && draft.start ? clampedPoint ?? draft.start : { x: 0, y: 0 };

      if (draft?.type === "move") {
        editorEngine.commitDrag();
      }

      if (draft?.type === "shape") {
        const bounds = toRect(draft.start, end, DEFAULT_SHAPE_BOUNDS);
        createAnnotation({
          type: "SHAPE",
          pageId: activePageId,
          bounds,
          shape: draft.mode,
        });
      }

      if (draft?.type === "line") {
        createAnnotation({
          type: "LINE",
          pageId: activePageId,
          start: draft.start,
          end,
          lineKind: draft.lineKind,
        });
      }

      if (draft?.type === "table") {
        const bounds = toRect(draft.start, end, DEFAULT_SHAPE_BOUNDS);
        createAnnotation({
          type: "TABLE",
          pageId: activePageId,
          bounds,
          rows: clampTextInput(tableRows),
          columns: clampTextInput(tableColumns),
        });
      }

      if (draft) {
        activeDragRef.current = null;
        renderSchedule();
      }
    },
    [activePageId, clampSize, createAnnotation, editorEngine, renderSchedule, tableColumns, tableRows],
  );

  const handlePointerCancel = useCallback(() => {
    const draft = activeDragRef.current;
    if (!draft) {
      return;
    }

    if (draft.type === "move") {
      editorEngine.cancelDrag();
    }

    activeDragRef.current = null;
    renderSchedule();
  }, [editorEngine, renderSchedule]);

  const handlePointerMoveLegacy = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const point = getSnapshotPoint(event, stageElementRef);
      if (!point) {
        setPointer(null);
        return;
      }

      const normalized = clampSize(point);
      setPointer(normalized);

      const drag = activeDragRef.current;
      if (!drag) {
        return;
      }

      if (drag.type === "move") {
        editorEngine.moveDrag(normalized);
        renderSchedule();
        return;
      }

      activeDragRef.current = {
        ...drag,
        end: normalized,
      };
      renderSchedule();
    },
    [clampSize, editorEngine, renderSchedule, setPointer],
  );

  const handlePointerLeave = useCallback(() => {
    setPointer(null);
  }, [setPointer]);

  const handleUndo = useCallback(() => {
    if (!editorSnapshot.canUndo) {
      return;
    }

    editorEngine.undo();
    renderSchedule();
  }, [editorEngine, editorSnapshot.canUndo, renderSchedule]);

  const handleRedo = useCallback(() => {
    if (!editorSnapshot.canRedo) {
      return;
    }

    editorEngine.redo();
    renderSchedule();
  }, [editorEngine, editorSnapshot.canRedo, renderSchedule]);

  const handleDelete = useCallback(() => {
    if (!editorSnapshot.selectedAnnotationId) {
      return;
    }

    editorEngine.deleteSelected();
    renderSchedule();
  }, [editorEngine, editorSnapshot.selectedAnnotationId, renderSchedule]);

  useEffect(() => {
    const draft = activeDragRef.current;
    if (!draft) {
      return;
    }

    if (draft.type === "move") {
      editorEngine.cancelDrag();
    }

    activeDragRef.current = null;
    renderSchedule();
  }, [activePageId, editorEngine, renderSchedule]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        if (activeDragRef.current) {
          if (activeDragRef.current.type === "move") {
            editorEngine.cancelDrag();
          }

          activeDragRef.current = null;
          renderSchedule();
        }

        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (editorSnapshot.selectedAnnotationId) {
          event.preventDefault();
          handleDelete();
        }

        return;
      }

      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) {
        return;
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }

        return;
      }

      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editorEngine, editorSnapshot.selectedAnnotationId, handleDelete, handleRedo, handleUndo, renderSchedule]);

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
  }, [containerWidth, fitWidthTargetPageWidth, setZoom, setZoomMode]);

  const loadingMessage = useMemo(() => {
    if (state.status !== "loading") {
      return null;
    }

    if (!state.document) {
      return "臾몄꽌 濡쒕뵫 以묒엯?덈떎.";
    }

    return state.totalPages > 0
      ? `${state.currentPage} / ${state.totalPages} ?섏씠吏瑜??뚮뜑留?以묒엯?덈떎.`
      : "臾몄꽌瑜??뚮뜑留?以묒엯?덈떎.";
  }, [state.document, state.status, state.totalPages, state.currentPage]);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <header className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Document Workspace</h1>
            <p className="text-sm text-slate-600">Open a PDF or a blank document to start annotating.</p>
          </div>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600">
            ?곹깭: {state.status}
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
        <DocumentSidebar
          totalPages={state.totalPages}
          currentPage={state.currentPage}
          onMove={handlePageSubmit}
          disabled={state.status !== "ready" || !isPdfReady}
        />

        <DocumentStage
        state={state}
        mode={state.status}
        statusMessage={state.status === "error" ? state.errorMessage : loadingMessage}
          canvasRef={setCanvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMoveLegacy}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          stageRef={stageRef}
          pointer={state.pointer}
        >
          <AnnotationCanvasLayer
            ref={annotationCanvasRef}
            hidden={!hasDocument || state.status !== "ready"}
            width={Math.max(1, stageSize.width)}
            height={Math.max(1, stageSize.height)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
          />
        </DocumentStage>

        <div className="space-y-4">
          <EditorDevelopmentToolbar
            mode={interactionMode}
            onModeChange={(mode: EditorInteractionMode) => {
              setInteractionMode(mode);
              activeDragRef.current = null;
            }}
            textValue={textMemo}
            onTextChange={setTextMemo}
            rows={tableRows}
            columns={tableColumns}
            onRowsChange={(next: number) => setTableRows(clampTextInput(next))}
            onColumnsChange={(next: number) => setTableColumns(clampTextInput(next))}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDelete={handleDelete}
            canUndo={editorSnapshot.canUndo}
            canRedo={editorSnapshot.canRedo}
            canDelete={Boolean(editorSnapshot.selectedAnnotationId)}
            hasDocument={hasDocument}
          />

          <EditorDebugPanel
            editorSnapshot={editorSnapshot}
            interactionMode={interactionMode}
            pageSize={{
              width: stageSize.width,
              height: stageSize.height,
            }}
            canvasWidth={stageSize.width}
            canvasHeight={stageSize.height}
            dpr={dpr}
            pointer={state.pointer}
            selectedAnnotation={selectedSerializedAnnotation}
            undoStackSize={undoStackSize}
            redoStackSize={redoStackSize}
          />

          <DocumentDebugPanel state={state} documentName={documentName} pointer={state.pointer} />
        </div>
      </div>
    </main>
  );
}






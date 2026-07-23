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
import {
  clientPointToNormalized,
  normalizedPointToCss,
  normalizedRectToCss,
} from "../coordinates/coordinate-transformer";
import type { PdfDocumentDescriptor, PageTextItem } from "../model/document-types";
import { useDocumentSession } from "../hooks/use-document-session";
import { useFitWidth } from "../hooks/use-fit-width";
import { usePageRender } from "../hooks/use-page-render";
import { LocalEditorPersistence, PersistenceCoordinator, type DocumentRecordViewState, SEMANTIC_EXTRACTOR_VERSION, SEMANTIC_SCHEMA_VERSION } from "../local-persistence";
import {
  buildPageSemanticModel,
  PageSemanticModel,
  type SemanticCandidate,
} from "@ggulnote/document-core";
import { DocumentDebugPanel } from "./document-debug-panel";
import { DocumentSidebar } from "./document-sidebar";
import { DocumentStage } from "./document-stage";
import { DocumentToolbar } from "./document-toolbar";

const ZOOM_STEP = 25;
const DRAG_CREATE_THRESHOLD_PX = 4;

const DEFAULT_STROKE_COLOR = "#1f2937";
const DEFAULT_FILL_COLOR = "rgba(250, 204, 21, 0.25)";
const DEFAULT_TEXT_COLOR = "#111827";
const DEFAULT_TEXT_FONT_FAMILY = "Arial";
const DEFAULT_TEXT_FONT_SIZE = 14;
const DEFAULT_TEXT_FONT_WEIGHT = "normal";
const DEFAULT_HIGHLIGHT_OPACITY = 0.35;

const DEFAULT_TEXT_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.04,
  height: 0.03,
};

const DEFAULT_UNDERLINE_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.08,
  height: 0.004,
};

const DEFAULT_HIGHLIGHT_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.06,
  height: 0.02,
};

const DEFAULT_SHAPE_BOUNDS: Omit<NormalizedRect, "x" | "y"> = {
  width: 0.05,
  height: 0.05,
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
      type: "text";
      start: NormalizedPoint;
      end: NormalizedPoint;
      text: string;
    }
  | {
      type: "underline";
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      type: "highlight";
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      type: "table";
      start: NormalizedPoint;
      end: NormalizedPoint;
      rows: number;
      columns: number;
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

function isDragDistanceEnough(
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageSize: {
    width: number;
    height: number;
  },
): boolean {
  if (!Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)) {
    return false;
  }

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return false;
  }

  const dx = (end.x - start.x) * pageSize.width;
  const dy = (end.y - start.y) * pageSize.height;

  return Math.hypot(dx, dy) >= DRAG_CREATE_THRESHOLD_PX;
}

const SEMANTIC_QUERY_MAX_RESULTS = 10;

const SEMANTIC_LAYER_STYLES: Array<{
  key: "text" | "word" | "line" | "sentence" | "paragraph" | "candidate";
  label: string;
  color: string;
}> = [
  { key: "text", label: "Text", color: "rgba(59, 130, 246, 0.95)" },
  { key: "word", label: "Word", color: "rgba(16, 185, 129, 0.95)" },
  { key: "line", label: "Line", color: "rgba(249, 115, 22, 0.95)" },
  { key: "sentence", label: "Sentence", color: "rgba(168, 85, 247, 0.95)" },
  { key: "paragraph", label: "Paragraph", color: "rgba(14, 116, 144, 0.95)" },
  { key: "candidate", label: "Candidate", color: "rgba(251, 146, 60, 1)" },
];

type SemanticDebugLayerState = {
  textItems: boolean;
  words: boolean;
  lines: boolean;
  sentences: boolean;
  paragraphs: boolean;
  candidates: boolean;
};

const initialSemanticDebugLayer: SemanticDebugLayerState = {
  textItems: false,
  words: false,
  lines: false,
  sentences: false,
  paragraphs: false,
  candidates: true,
};

function shortenText(value: string, maxLength = 80): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function clampSemanticCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function clampSemanticRect(value: NormalizedRect): NormalizedRect {
  const x1 = clampSemanticCoord(value.x);
  const y1 = clampSemanticCoord(value.y);
  const x2 = clampSemanticCoord(value.x + value.width);
  const y2 = clampSemanticCoord(value.y + value.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}
export function DocumentWorkspace(): React.ReactElement {
  const {
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
  } = useDocumentSession();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pageProxy, setPageProxy] = useState<import("pdfjs-dist/types/src/display/api").PDFPageProxy | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [interactionMode, setInteractionMode] = useState<EditorInteractionMode>(DEFAULT_INTERACTION_MODE);
  const [textMemo, setTextMemo] = useState("memo");
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);

  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE_COLOR);
  const [shapeFillColor, setShapeFillColor] = useState(DEFAULT_FILL_COLOR);
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(2);
  const [shapeFilled, setShapeFilled] = useState(false);
  const [lineStrokeWidth, setLineStrokeWidth] = useState(2);
  const [underlineThickness, setUnderlineThickness] = useState(2);
  const [tableStrokeWidth, setTableStrokeWidth] = useState(1);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [textFontSize, setTextFontSize] = useState(DEFAULT_TEXT_FONT_SIZE);
  const [textFontFamily, setTextFontFamily] = useState(DEFAULT_TEXT_FONT_FAMILY);
  const [textFontWeight, setTextFontWeight] = useState<"normal" | "bold">(DEFAULT_TEXT_FONT_WEIGHT);
  const [highlightColor, setHighlightColor] = useState("#facc15");
  const [highlightOpacity, setHighlightOpacity] = useState(DEFAULT_HIGHLIGHT_OPACITY);

  const [editorEngine] = useState(() => new EditorEngine());
  const annotationCanvasRef = useRef<AnnotationCanvasHandle | null>(null);
  const rendererRef = useRef(new NativeCanvasRenderer());
  const activeDragRef = useRef<DragDraft | null>(null);
  const renderFrameRef = useRef<number | null>(null);

  const pageRequestTokenRef = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stageElementRef = useRef<HTMLDivElement | null>(null);

  const [dpr, setDpr] = useState(1);
  const persistenceViewStateRef = useRef<DocumentRecordViewState>({
    currentPage: 1,
    zoom: 100,
    zoomMode: "custom",
  });
  const [localPersistence] = useState(() => new LocalEditorPersistence());
  // The callback reads the latest view state only when an operation event runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [persistenceCoordinator] = useState(() =>
    new PersistenceCoordinator(editorEngine, localPersistence, {
      onSaveStateChange: (saveState) => {
        dispatch({
          type: "PERSISTENCE_STATUS_CHANGED",
          status: saveState.status,
          errorMessage: saveState.errorMessage,
        });
      },
      getDocumentViewState: () => ({
        currentPage: persistenceViewStateRef.current.currentPage,
        zoom: persistenceViewStateRef.current.zoom,
        zoomMode: persistenceViewStateRef.current.zoomMode,
      }),
    }),
  );


  useEffect(() => {
    if (typeof window !== "object") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const next = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      setDpr(next);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);


  const renderSchedule = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (renderFrameRef.current !== null) {
      return;
    }

    const width = state.renderedWidth > 0 ? state.renderedWidth : state.page?.width ?? 0;
    const height = state.renderedHeight > 0 ? state.renderedHeight : state.page?.height ?? 0;

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;

      const canvasRef = annotationCanvasRef.current?.getCanvas();
      if (!canvasRef || !width || !height) {
        return;
      }

      const renderer = rendererRef.current;
      renderer.setCanvas(canvasRef);
      renderer.setSize(width, height, dpr);
      try {
        editorEngine.render(renderer, dpr);
      } catch {
        return;
      }
    });
  }, [
    dpr,
    editorEngine,
    state.page?.height,
    state.page?.width,
    state.renderedHeight,
    state.renderedWidth,
  ]);

  useEffect(() => {
    persistenceViewStateRef.current = {
      currentPage: state.currentPage,
      zoom: state.zoom,
      zoomMode: state.zoomMode,
    };
  }, [state.currentPage, state.zoom, state.zoomMode]);

  const hasRestoredDocumentRef = useRef(false);
  const pageSemanticModelRef = useRef<PageSemanticModel | null>(null);
  const semanticBuildTokenRef = useRef(0);
  const semanticBuildPageKeyRef = useRef<string | null>(null);
  const semanticBuildSignatureRef = useRef<string>("");
  const activePageId = state.document ? `${state.document.id}-page-${state.currentPage}` : null;
  const hydratedPagesRef = useRef(new Set<string>());
  const hydrationRequestRef = useRef(0);
  const isWorkspaceMountedRef = useRef(true);
  const textItemsOnPageRef = useRef<PageTextItem[]>([]);

  const [semanticCandidates, setSemanticCandidates] = useState<SemanticCandidate[]>([]);
  const [semanticDebugTextItems, setSemanticDebugTextItems] = useState<PageTextItem[]>([]);
  const [semanticDebugModel, setSemanticDebugModel] = useState<PageSemanticModel | null>(null);
  const [semanticDebugLayer, setSemanticDebugLayer] = useState<SemanticDebugLayerState>(initialSemanticDebugLayer);

  const clearSemanticQuery = useCallback(() => {
    setSemanticCandidates([]);
    dispatch({ type: "SEMANTIC_CLEAR_QUERY" });
  }, [dispatch]);

  const runSemanticPointQuery = useCallback(
    (point: NormalizedPoint | null, pageId: string | null) => {
      if (!point || pageId === null || !isWorkspaceMountedRef.current) {
        clearSemanticQuery();
        return;
      }

      const model = semanticDebugModel;
      if (!model) {
        clearSemanticQuery();
        return;
      }

      const searchRadius = 0.012;
      const candidates = (() => {
        const atPointCandidates = model.findAtPoint(point, {
          types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH"],
          limit: SEMANTIC_QUERY_MAX_RESULTS,
        });

        if (atPointCandidates.length > 0) {
          return atPointCandidates;
        }

        const nearestCandidates = model.findNearest(point, {
          types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH"],
          limit: SEMANTIC_QUERY_MAX_RESULTS,
          maxDistance: searchRadius * 5,
        });

        if (nearestCandidates.length > 0) {
          return nearestCandidates;
        }

        return model.findInRect(
          {
            x: Math.max(0, point.x - searchRadius),
            y: Math.max(0, point.y - searchRadius),
            width: searchRadius * 2,
            height: searchRadius * 2,
          },
          {
            types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH"],
            limit: SEMANTIC_QUERY_MAX_RESULTS,
            minimumOverlapRatio: 0,
          },
        );
      })();

      setSemanticCandidates(candidates);

      if (candidates.length === 0) {
        dispatch({
          type: "SEMANTIC_CLEAR_QUERY",
        });
        return;
      }

      const nearest = candidates[0];
      dispatch({
        type: "SEMANTIC_QUERY_UPDATED",
        selectedType: nearest.type,
        selectedId: nearest.id,
        selectedText: nearest.text,
        selectedBounds: nearest.bounds,
        candidateCount: candidates.length,
        nearestDistance: Number.isFinite(nearest.distance) ? nearest.distance : null,
      });
    },
    [clearSemanticQuery, dispatch, semanticDebugModel],
  );

  const dispatchSemanticStatus = useCallback(
    ({
      status,
      cacheStatus,
      sourceItemCount,
      wordCount,
      lineCount,
      sentenceCount,
      paragraphCount,
      columnCount,
      processingDurationMs,
      extractorVersion,
      schemaVersion,
    }: {
      status: "idle" | "processing" | "ready" | "empty" | "error";
      cacheStatus: "idle" | "hit" | "miss" | "stale" | "error" | "disabled";
      sourceItemCount: number;
      wordCount: number;
      lineCount: number;
      sentenceCount: number;
      paragraphCount: number;
      columnCount: number;
      processingDurationMs: number;
      extractorVersion: string;
      schemaVersion: number;
    }) => {
      dispatch({
        type: "SEMANTIC_STATUS_UPDATED",
        status,
        cacheStatus,
        sourceItemCount,
        wordCount,
        lineCount,
        sentenceCount,
        paragraphCount,
        columnCount,
        processingDurationMs,
        extractorVersion,
        schemaVersion,
      });
    },
    [dispatch],
  );

  const dispatchSemanticEmpty = useCallback((message: string) => {
    semanticBuildPageKeyRef.current = null;
    semanticBuildSignatureRef.current = "";
    dispatchSemanticStatus({
      status: "empty",
      cacheStatus: "disabled",
      sourceItemCount: 0,
      wordCount: 0,
      lineCount: 0,
      sentenceCount: 0,
      paragraphCount: 0,
      columnCount: 0,
      processingDurationMs: 0,
      extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
    });
    setSemanticDebugTextItems([]);
    setSemanticDebugModel(null);
    clearSemanticQuery();
    pageSemanticModelRef.current = null;
    textItemsOnPageRef.current = [];
  }, [clearSemanticQuery, dispatchSemanticStatus]);

  const getSemanticTextSignature = useCallback((textItems: PageTextItem[]): string => {
    let hash = 2166136261;
    const updateHash = (value: string): void => {
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    };

    for (const item of textItems) {
      updateHash(item.id);
      updateHash(item.text);
      updateHash(String(item.sourceIndex));
      updateHash(item.bounds.x.toFixed(6));
      updateHash(item.bounds.y.toFixed(6));
      updateHash(item.bounds.width.toFixed(6));
      updateHash(item.bounds.height.toFixed(6));
    }

    return `${textItems.length}:${(hash >>> 0).toString(16)}`;
  }, []);

  const hydrateSemanticModel = useCallback(
    async (
      documentId: string,
      pageId: string,
      pageNumber: number,
      textItems: PageTextItem[],
      requestToken: number,
    ) => {
      if (!isWorkspaceMountedRef.current || requestToken !== semanticBuildTokenRef.current) {
        return;
      }

      const signature = getSemanticTextSignature(textItems);
      if (
        pageId === semanticBuildPageKeyRef.current
        && signature === semanticBuildSignatureRef.current
        && pageSemanticModelRef.current !== null
      ) {
        return;
      }

      textItemsOnPageRef.current = textItems;
      setSemanticDebugTextItems(textItems);
      setSemanticDebugModel(null);

      if (textItems.length === 0) {
        dispatchSemanticEmpty("텍스트 아이템이 없어 Semantic Layer를 생성하지 않습니다.");
        return;
      }

      dispatchSemanticStatus({
        status: "processing",
        cacheStatus: "idle",
        sourceItemCount: textItems.length,
        wordCount: 0,
        lineCount: 0,
        sentenceCount: 0,
        paragraphCount: 0,
        columnCount: 0,
        processingDurationMs: 0,
        extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
        schemaVersion: SEMANTIC_SCHEMA_VERSION,
      });

      let cacheStatus: "hit" | "miss" | "stale" | "error" = "miss";
      let model: PageSemanticModel | null = null;

      try {
        const cachedRecord = await localPersistence.getSemanticPage(documentId, pageId, {
          extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
          semanticSchemaVersion: SEMANTIC_SCHEMA_VERSION,
        });
        if (requestToken !== semanticBuildTokenRef.current || !isWorkspaceMountedRef.current) {
          return;
        }

        if (cachedRecord && cachedRecord.sourceItemCount === textItems.length) {
          model = PageSemanticModel.fromSerialized(cachedRecord.model);
          cacheStatus = "hit";
        } else if (cachedRecord) {
          cacheStatus = "stale";
        }
      } catch {
        cacheStatus = "miss";
      }

      if (!model) {
        try {
          const builtModel = buildPageSemanticModel({
            documentId,
            pageId,
            pageNumber,
            textItems,
            extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
            schemaVersion: SEMANTIC_SCHEMA_VERSION,
          });

          if (requestToken !== semanticBuildTokenRef.current || !isWorkspaceMountedRef.current) {
            return;
          }

          model = builtModel;

          try {
            await localPersistence.saveSemanticPage({
              documentId,
              pageId,
              pageNumber,
              model: builtModel.toSerialized(),
              extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
              semanticSchemaVersion: SEMANTIC_SCHEMA_VERSION,
            });
          } catch {
            cacheStatus = "error";
          }
        } catch {
          dispatchSemanticStatus({
            status: "error",
            cacheStatus: "error",
            sourceItemCount: textItems.length,
            wordCount: 0,
            lineCount: 0,
            sentenceCount: 0,
            paragraphCount: 0,
            columnCount: 0,
            processingDurationMs: 0,
            extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
            schemaVersion: SEMANTIC_SCHEMA_VERSION,
          });
          return;
        }
      }

      if (!model || requestToken !== semanticBuildTokenRef.current || !isWorkspaceMountedRef.current) {
        return;
      }

      const summary = model.getSummary();
      const serialized = model.toSerialized();

      pageSemanticModelRef.current = model;
      semanticBuildPageKeyRef.current = pageId;
      semanticBuildSignatureRef.current = signature;
      if (summary.sourceItemCount === 0 || summary.wordCount + summary.lineCount + summary.sentenceCount + summary.paragraphCount === 0) {
        dispatchSemanticStatus({
          status: "empty",
          cacheStatus: "disabled",
          sourceItemCount: 0,
          wordCount: 0,
          lineCount: 0,
          sentenceCount: 0,
          paragraphCount: 0,
          columnCount: 0,
          processingDurationMs: 0,
          extractorVersion: SEMANTIC_EXTRACTOR_VERSION,
          schemaVersion: SEMANTIC_SCHEMA_VERSION,
        });
        clearSemanticQuery();
        return;
      }

      setSemanticDebugModel(model);
      dispatchSemanticStatus({
        status: "ready",
        cacheStatus,
        sourceItemCount: summary.sourceItemCount,
        wordCount: summary.wordCount,
        lineCount: summary.lineCount,
        sentenceCount: summary.sentenceCount,
        paragraphCount: summary.paragraphCount,
        columnCount: summary.columnCount,
        processingDurationMs: summary.processingDurationMs,
        extractorVersion: serialized.extractorVersion,
        schemaVersion: serialized.schemaVersion,
      });
    },
    [clearSemanticQuery, dispatchSemanticEmpty, dispatchSemanticStatus, getSemanticTextSignature, localPersistence],
  );

  useEffect(() => {
    isWorkspaceMountedRef.current = true;
    return () => {
      isWorkspaceMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    pageSemanticModelRef.current = null;
    semanticBuildPageKeyRef.current = null;
    semanticBuildSignatureRef.current = "";
    textItemsOnPageRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearSemanticQuery();
  }, [activePageId, clearSemanticQuery]);

  useEffect(() => {
    if (state.status !== "ready" || !state.document || state.document.kind !== "blank" || !activePageId) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    dispatchSemanticEmpty("백지 페이지는 Semantic Cache를 사용하지 않습니다.");
  }, [
    activePageId,
    dispatchSemanticEmpty,
    state.document?.kind,
    state.document?.id,
    state.document?.name,
    state.status,
    state.totalPages,
    state.document,
  ]);

  useEffect(() => {
    if (hasRestoredDocumentRef.current || state.status !== "empty") {
      return;
    }

    hasRestoredDocumentRef.current = true;
    const restore = async () => {
      const saved = await localPersistence.getLastOpenedDocument();
      if (!saved) {
        return;
      }

      if (saved.document.kind === "pdf") {
        if (!saved.file) {
          return;
        }

        const restoredPdfDocument: PdfDocumentDescriptor = {
          id: saved.document.id,
          kind: "pdf",
          name: saved.document.name,
          pageCount: saved.document.pageCount,
          fileSize: saved.file.size,
        };

        const opened = await openPersistedPdfDocument(restoredPdfDocument, saved.file.blob);
        if (!opened) {
          return;
        }
      } else {
        openBlankFromDescriptor({
          id: saved.document.id,
          kind: "blank",
          name: saved.document.name,
          pageCount: saved.document.pageCount,
        });
      }

      goToPage(saved.document.currentPage);
      setZoom(saved.document.zoom);
      setZoomMode(saved.document.zoomMode);
    };

    void restore();
  }, [
    goToPage,
    localPersistence,
    openBlankFromDescriptor,
    openPersistedPdfDocument,
    setZoom,
    setZoomMode,
    state.status,
  ]);
  useEffect(() => {
    if (state.document && state.status === "ready") {
      persistenceCoordinator.start(state.document.id);
      return;
    }

    persistenceCoordinator.stop();
  }, [persistenceCoordinator, state.document, state.status]);



  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void persistenceCoordinator.flush();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistenceCoordinator]);

  useEffect(() => {
    return () => {
      void persistenceCoordinator.stopAndFlush();
    };
  }, [persistenceCoordinator]);

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

  const canApplyToSelected = Boolean(editorSnapshot.selectedAnnotationId);

  const canGoPrevious = state.currentPage > 1 && state.totalPages > 1;
  const canGoNext = state.currentPage < state.totalPages;
  const documentName = useMemo(() => state.document?.name ?? "-", [state.document?.name]);
  const isPdfReady = state.document?.kind === "pdf" && state.status === "ready";
  const hasDocument = Boolean(state.document);


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
    if (state.status === "ready" && state.document?.id) {
      editorEngine.setDocument(state.document.id);
    } else {
      editorEngine.setDocument(null);
    }
  }, [editorEngine, state.document?.id, state.status]);

  useEffect(() => {
    if (state.status !== "ready" || !activePageId) {
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
  }, [activePageId, editorEngine, stageSize, state.renderedHeight, state.renderedWidth, state.status]);
  useEffect(() => {
    if (
      state.status !== "ready"
      || !activePageId
      || !state.document
      || !state.page?.id
      || editorSnapshot.documentId !== state.document.id
      || editorSnapshot.activePageId !== activePageId
    ) {
      return;
    }

    const pageHydrationKey = `${state.document.id}:${activePageId}`;
    if (hydratedPagesRef.current.has(pageHydrationKey)) {
      return;
    }

    const requestId = ++hydrationRequestRef.current;
    if (editorEngine.getDocumentId() !== state.document.id) {
      editorEngine.setDocument(state.document.id);
    }

    if (persistenceCoordinator.documentId !== state.document.id) {
      persistenceCoordinator.start(state.document.id);
    }

    void persistenceCoordinator.hydratePage(state.document.id, activePageId, (snapshot) => {
      if (!isWorkspaceMountedRef.current || requestId !== hydrationRequestRef.current) {
        return;
      }

      if (editorEngine.getDocumentId() !== state.document?.id || editorEngine.getActivePageId() !== activePageId) {
        return;
      }

      editorEngine.hydratePage(snapshot);
      hydratedPagesRef.current.add(pageHydrationKey);
      renderSchedule();
    });
  }, [
    activePageId,
    editorEngine,
    persistenceCoordinator,
    renderSchedule,
    editorSnapshot.documentId,
    editorSnapshot.activePageId,
    state.document,
    state.status,
    state.page?.id,
  ]);

  useEffect(() => {
    hydratedPagesRef.current.clear();
  }, [state.document?.id]);

  useEffect(() => {
    return () => {
      queueMicrotask(() => {
        if (!isWorkspaceMountedRef.current) {
          editorEngine.destroy();
        }
      });
    };
  }, [editorEngine]);


  useEffect(() => {
    renderSchedule();
  }, [editorSnapshot.revision, renderSchedule, activePageId, state.status]);

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
          dispatch({ type: "LOAD_FAILED", message: "Failed to load the page." });
        }
      }
    };

    void loadPage();
  }, [dispatch, getPage, isPdfReady, state.currentPage, state.status]);

  const handlePageRendered = useCallback(
    ({
      width,
      height,
      renderedWidth,
      renderedHeight,
    }: {
      width: number;
      height: number;
      renderedWidth: number;
      renderedHeight: number;
    }) => {
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

      const semanticRequestToken = ++semanticBuildTokenRef.current;
      const semanticRequestDocumentId = state.document.id;
      const semanticRequestPageId = `${state.document.id}-page-${state.currentPage}`;
      const semanticRequestPageNumber = state.currentPage;

      void requestPageText(pageProxy, semanticRequestPageNumber, {
        width,
        height,
      }).then((textContent) => {
        if (!textContent) {
          dispatchSemanticEmpty("텍스트 추출 실패로 Semantic Layer를 건너뜁니다.");
          return;
        }

        if (
          semanticRequestToken !== semanticBuildTokenRef.current ||
          !isWorkspaceMountedRef.current ||
          !semanticRequestDocumentId
        ) {
          return;
        }

        void hydrateSemanticModel(
          semanticRequestDocumentId,
          semanticRequestPageId,
          semanticRequestPageNumber,
          textContent.items,
          semanticRequestToken,
        );
      });
    },
    [
      dispatch,
      dispatchSemanticEmpty,
      hydrateSemanticModel,
      pageProxy,
      requestPageText,
      state.currentPage,
      state.document,
    ],
  );

  const handlePageRenderError = useCallback(
    (message: string) => {
      dispatch({ type: "LOAD_FAILED", message });
    },
    [dispatch],
  );

  usePageRender({
    canvas,
    page: pageProxy,
    zoom: state.zoom,
    onRendered: handlePageRendered,
    onError: handlePageRenderError,
  });

  const getLayerStyle = (
    key: "text" | "word" | "line" | "sentence" | "paragraph" | "candidate",
  ) => {
    const style = SEMANTIC_LAYER_STYLES.find((entry) => entry.key === key);
    return style ?? { key, label: key, color: "rgba(0, 0, 0, 0.5)" };
  };

  const semanticDebugLayerNodes = (() => {
    if (state.status !== "ready" || stageSize.width <= 0 || stageSize.height <= 0) {
      return null;
    }

    type DebugLayerItem = {
      key: "text" | "word" | "line" | "sentence" | "paragraph" | "candidate";
      id: string;
      label: string;
      rect: NormalizedRect;
      suffix?: string;
    };

    const objects: DebugLayerItem[] = [];

    if (semanticDebugLayer.textItems) {
      objects.push(
        ...semanticDebugTextItems.map((item) => ({
          key: "text" as const,
          id: item.id,
          label: `TEXT #${item.sourceIndex}`,
          rect: clampSemanticRect(item.bounds),
          suffix: item.text,
        })),
      );
    }

      const model = semanticDebugModel;
    if (model) {
      const semanticObjects = model.getAllByReadingOrder();

      if (semanticDebugLayer.words) {
        objects.push(
          ...semanticObjects
            .filter((item) => item.type === "WORD")
            .map((item) => ({
              key: "word" as const,
              id: item.id,
              label: `WORD #${item.readingOrder}`,
              rect: clampSemanticRect(item.bounds),
              suffix: item.text,
            })),
        );
      }

      if (semanticDebugLayer.lines) {
        objects.push(
          ...semanticObjects
            .filter((item) => item.type === "LINE")
            .map((item) => ({
              key: "line" as const,
              id: item.id,
              label: `LINE #${item.readingOrder}`,
              rect: clampSemanticRect(item.bounds),
              suffix: item.text,
            })),
        );
      }

      if (semanticDebugLayer.sentences) {
        objects.push(
          ...semanticObjects
            .filter((item) => item.type === "SENTENCE")
            .map((item) => ({
              key: "sentence" as const,
              id: item.id,
              label: `SENTENCE #${item.readingOrder}`,
              rect: clampSemanticRect(item.bounds),
              suffix: item.text,
            })),
        );
      }

      if (semanticDebugLayer.paragraphs) {
        objects.push(
          ...semanticObjects
            .filter((item) => item.type === "PARAGRAPH")
            .map((item) => ({
              key: "paragraph" as const,
              id: item.id,
              label: `PARAGRAPH #${item.readingOrder}`,
              rect: clampSemanticRect(item.bounds),
              suffix: item.text,
            })),
        );
      }
    }

    if (semanticDebugLayer.candidates) {
      objects.push(
        ...semanticCandidates.map((candidate) => ({
          key: "candidate" as const,
          id: `${candidate.type.toLowerCase()}-${candidate.id}`,
          label: `${candidate.type} #${candidate.readingOrder} (${candidate.distance.toFixed(4)})`,
          rect: clampSemanticRect(candidate.bounds),
          suffix: candidate.text,
        })),
      );
    }

    if (objects.length === 0) {
      return null;
    }

    return (
      <div className="pointer-events-none absolute inset-0">
        {objects.map((item) => {
          const style = getLayerStyle(item.key);
          const cssRect = normalizedRectToCss(item.rect, stageSize);
          if (cssRect.width <= 0 || cssRect.height <= 0) {
            return null;
          }

          const layerBorderWidth = 2;

          const renderedWidth = Math.max(cssRect.width, 1);
          const renderedHeight = Math.max(cssRect.height, 1);

          return (
            <div
              key={item.id}
              className="absolute"
              style={{
                left: `${cssRect.left}px`,
                top: `${cssRect.top}px`,
                width: `${renderedWidth}px`,
                height: `${renderedHeight}px`,
                border: `${layerBorderWidth}px solid ${style.color}`,
                backgroundColor: item.key === "candidate" ? `${style.color}80` : `${style.color}22`,
                opacity: 0.95,
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute -left-[2px] -top-[19px] rounded bg-black/70 px-1 text-[10px] font-medium"
                style={{ color: style.color }}
              >
                {`${style.label}: ${item.label}`}
              </span>
            </div>
          );
        })}
      </div>
    );
  })();

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

  const patchSelectedAnnotation = useCallback(
    (type: SerializedAnnotation["type"], properties: Record<string, unknown>) => {
      if (!selectedSerializedAnnotation || selectedSerializedAnnotation.type !== type) {
        return;
      }

      editorEngine.updateSelected({
        ...selectedSerializedAnnotation,
        properties: {
          ...(selectedSerializedAnnotation.properties ?? {}),
          ...properties,
        },
      });
      renderSchedule();
    },
    [editorEngine, renderSchedule, selectedSerializedAnnotation],
  );
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (state.status !== "ready" || !state.document) {
        return;
      }

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
          activeDragRef.current = {
            type: "text",
            start: normalized,
            end: normalized,
            text: textMemo,
          };
          break;
        }
        case "underline": {
          activeDragRef.current = {
            type: "underline",
            start: normalized,
            end: normalized,
          };
          break;
        }
        case "highlight": {
          activeDragRef.current = {
            type: "highlight",
            start: normalized,
            end: normalized,
          };
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
            rows: clampTextInput(tableRows),
            columns: clampTextInput(tableColumns),
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
      editorEngine,
      interactionMode,
      setPointer,
      stageSize.height,
      stageSize.width,
      state.document,
      state.renderedHeight,
      state.status,
      state.renderedWidth,
      tableColumns,
      tableRows,
      textMemo,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (state.status !== "ready") {
        return;
      }

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
    [clampSize, editorEngine, renderSchedule, setPointer, state.status],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (state.status !== "ready") {
        activeDragRef.current = null;
        clearSemanticQuery();
        return;
      }

      const point = getSnapshotPoint(event, stageElementRef);
      const clampedPoint = point ? clampSize(point) : null;
      if (!activePageId || !clampedPoint || !state.document) {
        activeDragRef.current = null;
        clearSemanticQuery();
        return;
      }

      const draft = activeDragRef.current;
      const end = draft && "start" in draft && draft.start ? clampedPoint : { x: 0, y: 0 };

      if (draft?.type === "move") {
        editorEngine.commitDrag();
      }

      if (draft?.type === "shape") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        const bounds = toRect(draft.start, end, DEFAULT_SHAPE_BOUNDS);
        createAnnotation({
          type: "SHAPE",
          pageId: activePageId,
          bounds,
          shape: draft.mode,
          strokeColor,
          fillColor: shapeFilled ? shapeFillColor : undefined,
          strokeWidth: shapeStrokeWidth,
          filled: shapeFilled,
        });
      }

      if (draft?.type === "line") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        createAnnotation({
          type: "LINE",
          pageId: activePageId,
          start: draft.start,
          end,
          lineKind: draft.lineKind,
          color: strokeColor,
          strokeWidth: lineStrokeWidth,
        });
      }

      if (draft?.type === "table") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        const bounds = toRect(draft.start, end, DEFAULT_SHAPE_BOUNDS);
        createAnnotation({
          type: "TABLE",
          pageId: activePageId,
          bounds,
          rows: draft.rows,
          columns: draft.columns,
          strokeColor,
          strokeWidth: tableStrokeWidth,
        });
      }

      if (draft?.type === "text") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        const bounds = toRect(draft.start, end, DEFAULT_TEXT_BOUNDS);
        createAnnotation({
          type: "TEXT",
          pageId: activePageId,
          bounds,
          text: draft.text,
          textColor,
          textFontFamily,
          textFontSize,
          textFontWeight,
        });
      }

      if (draft?.type === "underline") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        const bounds = toRect(draft.start, end, DEFAULT_UNDERLINE_BOUNDS);
        createAnnotation({
          type: "UNDERLINE",
          pageId: activePageId,
          bounds,
          color: strokeColor,
          thickness: underlineThickness,
        });
      }

      if (draft?.type === "highlight") {
        if (!isDragDistanceEnough(draft.start, end, stageSize)) {
          activeDragRef.current = null;
          renderSchedule();
          return;
        }

        const bounds = toRect(draft.start, end, DEFAULT_HIGHLIGHT_BOUNDS);
        createAnnotation({
          type: "HIGHLIGHT",
          pageId: activePageId,
          bounds,
          color: highlightColor,
          opacity: highlightOpacity,
        });
      }

      if (draft) {
        activeDragRef.current = null;
        renderSchedule();
      }

      if (state.document.kind === "pdf") {
        runSemanticPointQuery(clampedPoint, activePageId);
      } else {
        clearSemanticQuery();
      }
    },
    [
      activePageId,
      clearSemanticQuery,
      clampSize,
      createAnnotation,
      editorEngine,
      highlightColor,
      highlightOpacity,
      lineStrokeWidth,
      renderSchedule,
      runSemanticPointQuery,
      shapeFillColor,
      shapeFilled,
      shapeStrokeWidth,
      stageSize,
      state.document,
      state.status,
      strokeColor,
      tableStrokeWidth,
      textColor,
      textFontFamily,
      textFontSize,
      textFontWeight,
      underlineThickness,
    ],
  );
  /* eslint-disable react-hooks/refs -- Transient drag previews intentionally stay outside React state. */
  const dragPreview = (() => {
    const draft = activeDragRef.current;
    if (!draft || !("start" in draft) || !("end" in draft)) {
      return null;
    }

    if (!isDragDistanceEnough(draft.start, draft.end, stageSize)) {
      return null;
    }


    if (draft.type === "line") {
      const start = normalizedPointToCss(draft.start, stageSize);
      const end = normalizedPointToCss(draft.end, stageSize);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      if (!Number.isFinite(length) || length <= 0) {
        return null;
      }

      return (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${start.x}px`,
            top: `${start.y}px`,
            width: `${length}px`,
            borderBottom: `${Math.max(1, lineStrokeWidth)}px solid ${strokeColor}`,
            transformOrigin: "0 50%",
            transform: `rotate(${Math.atan2(dy, dx)}rad)`,
          }}
        />
      );
    }

    const fallback: Omit<NormalizedRect, "x" | "y"> =
      draft.type === "shape"
        ? DEFAULT_SHAPE_BOUNDS
        : draft.type === "text"
          ? DEFAULT_TEXT_BOUNDS
          : draft.type === "underline"
            ? DEFAULT_UNDERLINE_BOUNDS
            : draft.type === "highlight"
              ? DEFAULT_HIGHLIGHT_BOUNDS
              : DEFAULT_SHAPE_BOUNDS;

    const rect = toRect(draft.start, draft.end, fallback);
    const cssRect = normalizedRectToCss(rect, stageSize);

    if (draft.type === "shape") {
      const borderRadius = draft.mode === "ellipse" ? "50%" : "0";
      const fill = shapeFilled ? shapeFillColor : "transparent";

      return (
        <div
          className="pointer-events-none absolute border-2"
          style={{
            left: `${cssRect.left}px`,
            top: `${cssRect.top}px`,
            width: `${cssRect.width}px`,
            height: `${cssRect.height}px`,
            borderRadius,
            backgroundColor: fill,
            borderColor: strokeColor,
          }}
        />
      );
    }

    return (
      <div
        className="pointer-events-none absolute border border-slate-900 bg-slate-200/25"
        style={{
          left: `${cssRect.left}px`,
          top: `${cssRect.top}px`,
          width: `${cssRect.width}px`,
          height: `${cssRect.height}px`,
          borderColor: strokeColor,
        }}
      />
    );
  })();
  /* eslint-enable react-hooks/refs */
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
      const opened = await openPdfFile(file);
      if (!opened || !file) {
        return;
      }

      try {
        await localPersistence.createPdfDocument({
          document: {
            id: opened.id,
            name: opened.name,
            pageCount: opened.pageCount,
            currentPage: 1,
            zoom: state.zoom,
            zoomMode: state.zoomMode,
          },
          file: {
            blob: file,
            mimeType: "application/pdf",
            size: opened.fileSize,
            originalName: file.name,
            lastModified: file.lastModified,
          },
        });
      } catch (error) {
        console.error("PDF 문서 저장 실패", error);
      }
    },
    [localPersistence, openPdfFile, state.zoom, state.zoomMode],
  );

  const handleCreateBlank = useCallback(() => {
    const next = openBlankDocument();
    void localPersistence.createBlankDocument({
      document: {
        id: next.id,
        name: next.name,
        pageCount: next.pageCount,
        currentPage: 1,
        zoom: state.zoom,
        zoomMode: state.zoomMode,
      },
    });
  }, [localPersistence, openBlankDocument, state.zoom, state.zoomMode]);

  const handleCloseDocument = useCallback(() => {
    const closeCurrentDocument = async () => {
      await persistenceCoordinator.stopAndFlush();
      await closeDocument();
    };

    void closeCurrentDocument();
  }, [closeDocument, persistenceCoordinator]);
  const handlePageSubmit = useCallback(
    (nextPage: number) => {
      void persistenceCoordinator.flush().finally(() => {
        goToPage(nextPage);
      });
    },
    [goToPage, persistenceCoordinator],
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
      return "No document is loaded.";
    }

    return state.totalPages > 0
      ? `${state.currentPage} / ${state.totalPages} / Loading...`
      : "Page loading failed.";
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
            Status: {state.status}
          </span>
        </div>
      </header>

      <DocumentToolbar
        onOpenPdf={handleOpenPdf}
        onCreateBlank={handleCreateBlank}
        onClose={handleCloseDocument}
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
          {dragPreview}
          {semanticDebugLayerNodes}
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
            onStrokeColorChange={(next: string) => {
              setStrokeColor(next);
              patchSelectedAnnotation("LINE", { color: next });
              patchSelectedAnnotation("SHAPE", { strokeColor: next });
              patchSelectedAnnotation("UNDERLINE", { color: next });
              patchSelectedAnnotation("TABLE", { strokeColor: next });
            }}
            onFillColorChange={(next: string) => {
              setShapeFillColor(next);
              patchSelectedAnnotation("SHAPE", { fillColor: next });
            }}
            onFillEnabledChange={(next: boolean) => {
              setShapeFilled(next);
              patchSelectedAnnotation("SHAPE", { filled: next });
            }}
            onShapeStrokeWidthChange={(next: number) => {
              const width = Math.max(1, Math.round(next));
              setShapeStrokeWidth(width);
              patchSelectedAnnotation("SHAPE", { strokeWidth: width });
            }}
            onLineStrokeWidthChange={(next: number) => {
              const width = Math.max(1, Math.round(next));
              setLineStrokeWidth(width);
              patchSelectedAnnotation("LINE", { strokeWidth: width });
            }}
            onUnderlineThicknessChange={(next: number) => {
              const thickness = Math.max(1, Math.round(next));
              setUnderlineThickness(thickness);
              patchSelectedAnnotation("UNDERLINE", { thickness });
            }}
            onTableStrokeWidthChange={(next: number) => {
              const width = Math.max(1, Math.round(next));
              setTableStrokeWidth(width);
              patchSelectedAnnotation("TABLE", { strokeWidth: width });
            }}
            onTextColorChange={(next: string) => {
              setTextColor(next);
              patchSelectedAnnotation("TEXT", { textColor: next });
            }}
            onTextFontSizeChange={(next: number) => {
              const size = Math.max(8, Math.min(120, Math.round(next)));
              setTextFontSize(size);
              patchSelectedAnnotation("TEXT", { textFontSize: size });
            }}
            onTextFontFamilyChange={(next: string) => {
              setTextFontFamily(next);
              patchSelectedAnnotation("TEXT", { textFontFamily: next });
            }}
            onTextFontWeightChange={setTextFontWeight}
            onHighlightColorChange={(next: string) => {
              setHighlightColor(next);
              patchSelectedAnnotation("HIGHLIGHT", { color: next });
            }}
            onHighlightOpacityChange={(next: number) => {
              const opacity = Math.max(0, Math.min(1, next));
              setHighlightOpacity(opacity);
              patchSelectedAnnotation("HIGHLIGHT", { opacity });
            }}
            textFontSize={textFontSize}
            textFontFamily={textFontFamily}
            textFontWeight={textFontWeight}
            strokeColor={strokeColor}
            shapeFillColor={shapeFillColor}
            shapeStrokeWidth={shapeStrokeWidth}
            lineStrokeWidth={lineStrokeWidth}
            underlineThickness={underlineThickness}
            tableStrokeWidth={tableStrokeWidth}
            textColor={textColor}
            shapeFilled={shapeFilled}
            highlightColor={highlightColor}
            highlightOpacity={highlightOpacity}
            canApplyToSelected={canApplyToSelected}
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

          <DocumentDebugPanel
            state={state}
            documentName={documentName}
            pointer={state.pointer}
            semanticDebugLayer={semanticDebugLayer}
            semanticCandidates={semanticCandidates}
            onSemanticDebugLayerChange={setSemanticDebugLayer}
          />
        </div>
      </div>
    </main>
  );
}

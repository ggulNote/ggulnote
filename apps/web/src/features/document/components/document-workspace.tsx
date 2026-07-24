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
import type {
  PageTextContent,
  PageTextItem,
  PdfDocumentDescriptor,
  RawPdfTextItemDebug,
} from "../model/document-types";
import { useDocumentSession } from "../hooks/use-document-session";
import { useFitWidth } from "../hooks/use-fit-width";
import { usePageRender } from "../hooks/use-page-render";
import { LocalEditorPersistence, PersistenceCoordinator, type DocumentRecordViewState, SEMANTIC_EXTRACTOR_VERSION, SEMANTIC_SCHEMA_VERSION } from "../local-persistence";
import {
  buildPageSemanticModel,
  createSemanticSourceSignature,
  PageSemanticModel,
  type DetectedLayoutRegionInput,
  type SemanticCandidate,
} from "@ggulnote/document-core";
import { DocumentDebugPanel } from "./document-debug-panel";
import { DocumentSidebar } from "./document-sidebar";
import { DocumentStage } from "./document-stage";
import { DocumentToolbar } from "./document-toolbar";
import { PdfTextLayerDebug } from "./pdf-text-layer-debug";
import { isPageTextResultForPage } from "../text/page-text-request";
import {
  isCurrentLayoutResult,
  loadLayoutModelCatalog,
  replaceLayoutWorkerClient,
  renderPdfPageForLayoutDetection,
  type LayoutDetectionViewState,
  type LayoutModelCatalog,
  type LayoutWorkerClientContract,
} from "../layout-detection";
import { LayoutDetectionDebugPanel } from "./layout-detection-debug-panel";

const ZOOM_STEP = 25;
const DRAG_CREATE_THRESHOLD_PX = 4;
const LAYOUT_MODEL_STORAGE_KEY = "ggulnote:layout-detection:model-id";
const INITIAL_LAYOUT_DETECTION_STATE: LayoutDetectionViewState = {
  status: "idle",
  result: null,
};

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

type LoadedPdfPage = {
  documentId: string;
  pageId: string;
  pageNumber: number;
  page: import("pdfjs-dist/types/src/display/api").PDFPageProxy;
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

type SemanticLayerStyleKey =
  | "rawText"
  | "text"
  | "word"
  | "regionWord"
  | "unassignedWord"
  | "line"
  | "region"
  | "block"
  | "column"
  | "sentence"
  | "sentenceFragment"
  | "paragraph"
  | "paragraphFragment"
  | "readingOrder"
  | "regionRelation"
  | "candidate";

const SEMANTIC_LAYER_STYLES: Array<{
  key: SemanticLayerStyleKey;
  label: string;
  color: string;
}> = [
  { key: "rawText", label: "Raw PDF.js Text", color: "rgba(220, 38, 38, 0.95)" },
  { key: "text", label: "Text", color: "rgba(59, 130, 246, 0.95)" },
  { key: "word", label: "Word", color: "rgba(16, 185, 129, 0.95)" },
  { key: "regionWord", label: "Region Word", color: "rgba(5, 150, 105, 0.95)" },
  { key: "unassignedWord", label: "Unassigned Word", color: "rgba(220, 38, 38, 0.95)" },
  { key: "line", label: "Line", color: "rgba(249, 115, 22, 0.95)" },
  { key: "region", label: "Region", color: "rgba(236, 72, 153, 0.95)" },
  { key: "block", label: "Block", color: "rgba(234, 179, 8, 0.95)" },
  { key: "column", label: "Column", color: "rgba(6, 182, 212, 0.95)" },
  { key: "sentence", label: "Sentence", color: "rgba(168, 85, 247, 0.95)" },
  { key: "sentenceFragment", label: "Sentence fragment", color: "rgba(192, 132, 252, 0.95)" },
  { key: "paragraph", label: "Paragraph", color: "rgba(14, 116, 144, 0.95)" },
  { key: "paragraphFragment", label: "Paragraph fragment", color: "rgba(34, 211, 238, 0.95)" },
  { key: "readingOrder", label: "Reading order", color: "rgba(244, 63, 94, 0.95)" },
  { key: "regionRelation", label: "Region relation", color: "rgba(217, 70, 239, 0.95)" },
  { key: "candidate", label: "Candidate", color: "rgba(251, 146, 60, 1)" },
];

type SemanticDebugLayerState = {
  pdfTextLayer: boolean;
  rawTextItems: boolean;
  textItems: boolean;
  words: boolean;
  regionWords: boolean;
  unassignedWords: boolean;
  lines: boolean;
  layoutRegions: boolean;
  layoutBlocks: boolean;
  columns: boolean;
  sentences: boolean;
  sentenceFragments: boolean;
  paragraphs: boolean;
  paragraphFragments: boolean;
  readingOrder: boolean;
  regionRelations: boolean;
  candidates: boolean;
  boxOnly: boolean;
};

const initialSemanticDebugLayer: SemanticDebugLayerState = {
  pdfTextLayer: false,
  rawTextItems: false,
  textItems: false,
  words: false,
  regionWords: false,
  unassignedWords: false,
  lines: false,
  layoutRegions: false,
  layoutBlocks: false,
  columns: false,
  sentences: false,
  sentenceFragments: false,
  paragraphs: false,
  paragraphFragments: false,
  readingOrder: false,
  regionRelations: false,
  candidates: true,
  boxOnly: true,
};

function shortenText(value: string, maxLength = 80): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function preserveSemanticCoord(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampSemanticRect(value: NormalizedRect): NormalizedRect {
  return {
    x: preserveSemanticCoord(value.x),
    y: preserveSemanticCoord(value.y),
    width: Math.max(0, preserveSemanticCoord(value.width)),
    height: Math.max(0, preserveSemanticCoord(value.height)),
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
  const [pdfPageContext, setPdfPageContext] = useState<LoadedPdfPage | null>(null);
  const [layoutDetectionState, setLayoutDetectionState] = useState<LayoutDetectionViewState>(INITIAL_LAYOUT_DETECTION_STATE);
  const [layoutDetectionVisible, setLayoutDetectionVisible] = useState(true);
  const [layoutModelCatalog, setLayoutModelCatalog] = useState<LayoutModelCatalog | null>(null);
  const [selectedLayoutModelId, setSelectedLayoutModelId] = useState("");
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
  const layoutInferenceTokenRef = useRef(0);
  const layoutWorkerClientRef = useRef<LayoutWorkerClientContract | null>(null);
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


  const [semanticCandidates, setSemanticCandidates] = useState<SemanticCandidate[]>([]);
  const [pageTextDebug, setPageTextDebug] = useState<PageTextContent | null>(null);
  const [semanticDebugModel, setSemanticDebugModel] = useState<PageSemanticModel | null>(null);
  const [semanticDebugLayer, setSemanticDebugLayer] = useState<SemanticDebugLayerState>(initialSemanticDebugLayer);
  const visiblePageText = isPageTextResultForPage(
    pageTextDebug,
    state.document?.id ?? null,
    activePageId,
  ) ? pageTextDebug : null;
  const semanticDebugTextItems = visiblePageText?.items ?? [];
  const selectedRawTextItem = useMemo<RawPdfTextItemDebug | null>(() => {
    if (!state.pointer || !visiblePageText) return null;
    return visiblePageText.rawItems
      .filter((item) => {
        const bounds = item.computed.normalizedBounds;
        return state.pointer
          && state.pointer.x >= bounds.x
          && state.pointer.x <= bounds.x + bounds.width
          && state.pointer.y >= bounds.y
          && state.pointer.y <= bounds.y + bounds.height;
      })
      .sort((left, right) => {
        const leftArea = left.computed.width * left.computed.height;
        const rightArea = right.computed.width * right.computed.height;
        return leftArea - rightArea || left.sourceIndex - right.sourceIndex;
      })[0] ?? null;
  }, [state.pointer, visiblePageText]);

  const clearSemanticQuery = useCallback(() => {
    setSemanticCandidates([]);
    dispatch({ type: "SEMANTIC_CLEAR_QUERY" });
  }, [dispatch]);

  const runSemanticPointQuery = useCallback(
    (point: NormalizedPoint | null, pageId: string | null) => {
      if (!point || pageId === null || pageId !== activePageId || !isWorkspaceMountedRef.current) {
        clearSemanticQuery();
        return;
      }

      const model = visiblePageText ? semanticDebugModel : null;
      if (!model) {
        clearSemanticQuery();
        return;
      }

      const searchRadius = 0.012;
      const candidates = (() => {
        const atPointCandidates = model.findAtPoint(point, {
          types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH", "LAYOUT_REGION"],
          limit: SEMANTIC_QUERY_MAX_RESULTS,
        });

        if (atPointCandidates.length > 0) {
          return atPointCandidates;
        }

        const nearestCandidates = model.findNearest(point, {
          types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH", "LAYOUT_REGION"],
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
            types: ["WORD", "LINE", "SENTENCE", "PARAGRAPH", "LAYOUT_REGION"],
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
    [activePageId, clearSemanticQuery, dispatch, semanticDebugModel, visiblePageText],
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

    setSemanticDebugModel(null);
    clearSemanticQuery();
    pageSemanticModelRef.current = null;

  }, [clearSemanticQuery, dispatchSemanticStatus]);

  const getSemanticSourceSignature = useCallback(
    (textItems: PageTextItem[], layoutDetections: DetectedLayoutRegionInput[], modelId: string): string =>
      createSemanticSourceSignature(textItems, layoutDetections, modelId),
    [],
  );

  const hydrateSemanticModel = useCallback(
    async (
      documentId: string,
      pageId: string,
      pageNumber: number,
      textItems: PageTextItem[],
      layoutDetections: DetectedLayoutRegionInput[],
      layoutModelId: string,
      requestToken: number,
    ) => {
      if (!isWorkspaceMountedRef.current || requestToken !== semanticBuildTokenRef.current) {
        return;
      }

      const signature = getSemanticSourceSignature(textItems, layoutDetections, layoutModelId);
      if (
        pageId === semanticBuildPageKeyRef.current
        && signature === semanticBuildSignatureRef.current
        && pageSemanticModelRef.current !== null
      ) {
        return;
      }



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

        if (
          cachedRecord
          && cachedRecord.sourceItemCount === textItems.length
          && cachedRecord.sourceSignature === signature
          && cachedRecord.model.sourceSignature === signature
        ) {
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
            layoutDetections,
            layoutModelId,
            layoutStrategy: "yolo-region",
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
    [clearSemanticQuery, dispatchSemanticEmpty, dispatchSemanticStatus, getSemanticSourceSignature, localPersistence],
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
  const currentPdfPageContext = pdfPageContext
    && pdfPageContext.documentId === state.document?.id
    && pdfPageContext.pageId === activePageId
    && pdfPageContext.pageNumber === state.currentPage
    ? pdfPageContext
    : null;


  useEffect(() => {
    layoutInferenceTokenRef.current += 1;
  }, [activePageId, state.document?.id]);

  useEffect(() => {
    return () => {
      layoutInferenceTokenRef.current += 1;
      layoutWorkerClientRef.current?.dispose();
      layoutWorkerClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutModelCatalog().then((catalog) => {
      if (cancelled) return;
      setLayoutModelCatalog(catalog);
      const stored = window.localStorage.getItem(LAYOUT_MODEL_STORAGE_KEY);
      const selected = stored !== null && catalog.models.some((model) => model.enabled && model.id === stored) ? stored : catalog.defaultModelId;
      setSelectedLayoutModelId(selected);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLayoutDetectionState({ status: "error", result: null, errorMessage: error instanceof Error ? error.message : "Could not load layout model catalog." });
    });
    return () => { cancelled = true; };
  }, []);
  const runLayoutDetection = useCallback(async (modelId = selectedLayoutModelId) => {
    if (state.status !== "ready" || state.document?.kind !== "pdf" || !activePageId || !currentPdfPageContext) return;
    const model = layoutModelCatalog?.models.find((candidate) => candidate.enabled && candidate.id === modelId);
    if (!model) {
      setLayoutDetectionState({ pageId: activePageId, modelId, status: "error", result: null, errorMessage: "The selected layout model is unavailable." });
      return;
    }
    const requestToken = layoutInferenceTokenRef.current + 1;
    layoutInferenceTokenRef.current = requestToken;
    setLayoutDetectionState({ pageId: activePageId, modelId, status: "rendering", result: null });
    let bitmap: ImageBitmap | null = null;
    try {
      const rendered = await renderPdfPageForLayoutDetection(currentPdfPageContext.page, model.inputSize);
      bitmap = rendered.bitmap;
      if (requestToken !== layoutInferenceTokenRef.current) { bitmap.close(); return; }
      if (typeof Worker === "undefined") { bitmap.close(); throw new Error("Web Worker is not available in this browser."); }
      const client = replaceLayoutWorkerClient(layoutWorkerClientRef.current, model);
      layoutWorkerClientRef.current = client;
      setLayoutDetectionState({ pageId: activePageId, modelId, status: "initializing", result: null });
      await client.initialize();
      if (requestToken !== layoutInferenceTokenRef.current) { bitmap.close(); return; }
      setLayoutDetectionState({ pageId: activePageId, modelId, status: "inferencing", result: null });
      const result = await client.infer(activePageId, bitmap, rendered.renderMs);
      bitmap = null;
      if (requestToken !== layoutInferenceTokenRef.current || !isCurrentLayoutResult(result, activePageId, modelId)) return;
      setLayoutDetectionState({ pageId: activePageId, modelId, status: "ready", result });
    } catch (error: unknown) {
      bitmap?.close();
      if (requestToken !== layoutInferenceTokenRef.current) return;
      setLayoutDetectionState({ pageId: activePageId, modelId, status: "error", result: null, errorMessage: error instanceof Error ? error.message : "Document layout inference failed." });
    }
  }, [activePageId, currentPdfPageContext, layoutModelCatalog, selectedLayoutModelId, state.document?.kind, state.status]);

  useEffect(() => {
    if (!selectedLayoutModelId || !layoutModelCatalog || !currentPdfPageContext) return;
    const timer = window.setTimeout(() => {
      void runLayoutDetection();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentPdfPageContext, layoutModelCatalog, runLayoutDetection, selectedLayoutModelId]);

  const handleLayoutModelChange = useCallback((modelId: string) => {
    if (modelId === selectedLayoutModelId) return;
    layoutInferenceTokenRef.current += 1;
    layoutWorkerClientRef.current?.dispose();
    layoutWorkerClientRef.current = null;
    setSelectedLayoutModelId(modelId);
    window.localStorage.setItem(LAYOUT_MODEL_STORAGE_KEY, modelId);
    setLayoutDetectionState({ pageId: activePageId ?? undefined, modelId, status: "idle", result: null });
  }, [activePageId, selectedLayoutModelId]);
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
    if (!isPdfReady || !state.document || !activePageId) return;

    const token = pageRequestTokenRef.current + 1;
    pageRequestTokenRef.current = token;
    const requestedDocumentId = state.document.id;
    const requestedPageId = activePageId;
    const requestedPageNumber = state.currentPage;

    const loadPage = async () => {
      try {
        const page = await getPage(requestedPageNumber);
        if (pageRequestTokenRef.current === token && isWorkspaceMountedRef.current) {
          setPdfPageContext({
            documentId: requestedDocumentId,
            pageId: requestedPageId,
            pageNumber: requestedPageNumber,
            page,
          });
        }
      } catch {
        if (pageRequestTokenRef.current === token) {
          dispatch({ type: "LOAD_FAILED", message: "Failed to load the page." });
        }
      }
    };

    void loadPage();
  }, [activePageId, dispatch, getPage, isPdfReady, state.currentPage, state.document]);

  const handlePageRendered = useCallback(
    ({
      width,
      height,
      renderedWidth,
      renderedHeight,
      rotation,
    }: {
      width: number;
      height: number;
      renderedWidth: number;
      renderedHeight: number;
      rotation: number;
    }) => {
      if (!currentPdfPageContext || !state.document || currentPdfPageContext.pageId !== activePageId) {
        return;
      }

      dispatch({
        type: "PAGE_RENDERED",
        page: {
          id: currentPdfPageContext.pageId,
          pageNumber: currentPdfPageContext.pageNumber,
          width,
          height,
          rotation,
        },
        renderedWidth,
        renderedHeight,
      });

      const semanticRequestToken = ++semanticBuildTokenRef.current;
      const semanticRequestDocumentId = currentPdfPageContext.documentId;
      const semanticRequestPageId = currentPdfPageContext.pageId;
      const semanticRequestPageNumber = currentPdfPageContext.pageNumber;

      void requestPageText(currentPdfPageContext.page, {
        documentId: semanticRequestDocumentId,
        pageId: semanticRequestPageId,
        pageNumber: semanticRequestPageNumber,
      }).then((textContent) => {
        if (!textContent) {
          dispatchSemanticEmpty("텍스트 추출 실패로 Semantic Layer를 건너뜁니다.");
          return;
        }
        if (
          semanticRequestToken !== semanticBuildTokenRef.current
          || !isWorkspaceMountedRef.current
          || textContent.documentId !== semanticRequestDocumentId
          || textContent.pageId !== semanticRequestPageId
          || textContent.pageNumber !== semanticRequestPageNumber
        ) {
          return;
        }

        setPageTextDebug(textContent);
      });
    },
    [
      activePageId,
      currentPdfPageContext,
      dispatch,
      dispatchSemanticEmpty,
      requestPageText,
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
    page: currentPdfPageContext?.page ?? null,
    zoom: state.zoom,
    onRendered: handlePageRendered,
    onError: handlePageRenderError,
  });

  const activeLayoutDetectionState = layoutDetectionState.pageId === activePageId
    && layoutDetectionState.modelId === selectedLayoutModelId
    ? layoutDetectionState
    : INITIAL_LAYOUT_DETECTION_STATE;

  useEffect(() => {
    if (!visiblePageText || !activePageId || state.document?.kind !== "pdf") return;
    const layoutReady = activeLayoutDetectionState.status === "ready" && activeLayoutDetectionState.result !== null;
    const layoutFailed = activeLayoutDetectionState.status === "error";
    if (!layoutReady && !layoutFailed) return;
    const requestToken = ++semanticBuildTokenRef.current;
    const detections: DetectedLayoutRegionInput[] = layoutReady
      ? activeLayoutDetectionState.result?.detections.map((detection) => ({ ...detection, modelId: selectedLayoutModelId })) ?? []
      : [];
    void hydrateSemanticModel(visiblePageText.documentId, visiblePageText.pageId, visiblePageText.pageNumber,
      visiblePageText.items, detections, selectedLayoutModelId, requestToken);
  }, [activeLayoutDetectionState, activePageId, hydrateSemanticModel, selectedLayoutModelId, state.document?.kind, visiblePageText]);

  const layoutDetectionOverlayNodes = (() => {
    const result = layoutDetectionState.result;
    if (!layoutDetectionVisible || !result || result.pageId !== activePageId || result.modelId !== selectedLayoutModelId) return null;
    return (
      <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
        {result.detections.map((detection) => (
          <div key={`${result.pageId}:${detection.id}`} className="absolute border-2 border-cyan-500 bg-cyan-400/10" style={{ left: `${detection.bounds.x * 100}%`, top: `${detection.bounds.y * 100}%`, width: `${detection.bounds.width * 100}%`, height: `${detection.bounds.height * 100}%` }}>
            <span className="absolute left-0 top-0 max-w-full -translate-y-full truncate bg-cyan-700 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">{detection.label} {(detection.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    );
  })();

  const getLayerStyle = (
    key: SemanticLayerStyleKey,
  ) => {
    const style = SEMANTIC_LAYER_STYLES.find((entry) => entry.key === key);
    return style ?? { key, label: key, color: "rgba(0, 0, 0, 0.5)" };
  };

  const semanticDebugLayerNodes = (() => {
    if (state.status !== "ready" || stageSize.width <= 0 || stageSize.height <= 0) {
      return null;
    }

    type DebugLayerItem = {
      key: SemanticLayerStyleKey;
      id: string;
      label: string;
      rect: NormalizedRect;
      suffix?: string;
    };

    const objects: DebugLayerItem[] = [];

    if (semanticDebugLayer.rawTextItems && visiblePageText) {
      objects.push(
        ...visiblePageText.rawItems
          .filter((item) => item.str.trim().length > 0)
          .map((item) => ({
            key: "rawText" as const,
            id: `raw-${item.sourceIndex}`,
            label: `RAW #${item.sourceIndex}`,
            rect: clampSemanticRect(item.computed.normalizedBounds),
            suffix: item.str,
          })),
      );
    }

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
    const model = visiblePageText ? semanticDebugModel : null;
    if (model) {
      const semanticObjects = model.getAllByReadingOrder();

      if (semanticDebugLayer.words) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "WORD")
          .map((item) => ({
            key: "word" as const,
            id: item.id,
            label: "WORD #" + String(item.readingOrder),
            rect: clampSemanticRect(item.bounds),
            suffix: item.text,
          })));
      }

      if (semanticDebugLayer.regionWords) {
        objects.push(...semanticObjects.filter((item) => item.type === "WORD" && item.regionId !== "unassigned").map((item) => ({
          key: "regionWord" as const, id: item.id + "-region-word", label: "REGION WORD #" + String(item.readingOrder),
          rect: clampSemanticRect(item.bounds), suffix: item.regionId + " / " + item.text,
        })));
      }
      if (semanticDebugLayer.unassignedWords) {
        objects.push(...model.getUnassignedWords().map((item) => ({
          key: "unassignedWord" as const, id: item.id + "-unassigned", label: "UNASSIGNED #" + String(item.readingOrder),
          rect: clampSemanticRect(item.bounds), suffix: item.text,
        })));
      }
      if (semanticDebugLayer.lines) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "LINE")
          .map((item) => ({
            key: "line" as const,
            id: item.id,
            label: "LINE #" + String(item.readingOrder),
            rect: clampSemanticRect(item.bounds),
            suffix: item.text,
          })));
      }

      if (semanticDebugLayer.layoutRegions) {
        objects.push(...model.getLayoutRegions().map((region) => ({
          key: "region" as const,
          id: region.id,
          label: "REGION #" + String(region.readingOrder),
          rect: clampSemanticRect(region.bounds),
          suffix: region.layoutType + " / " + region.source + " / " + (region.confidence * 100).toFixed(0) + "%",
        })));
      }

      if (semanticDebugLayer.layoutBlocks) {
        objects.push(...model.getLayoutBlocks().map((block) => ({
          key: "block" as const,
          id: block.id,
          label: "BLOCK #" + String(block.readingOrder),
          rect: clampSemanticRect(block.bounds),
          suffix: block.type,
        })));
      }

      if (semanticDebugLayer.columns) {
        objects.push(...model.getColumns().map((column) => ({
          key: "column" as const,
          id: column.id,
          label: "COLUMN #" + String(column.columnIndex),
          rect: clampSemanticRect(column.bounds),
        })));
      }

      if (semanticDebugLayer.sentences) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "SENTENCE")
          .map((item) => ({
            key: "sentence" as const,
            id: item.id,
            label: "SENTENCE #" + String(item.readingOrder),
            rect: clampSemanticRect(item.bounds),
            suffix: item.text,
          })));
      }

      if (semanticDebugLayer.sentenceFragments) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "SENTENCE")
          .flatMap((item) => item.fragments.map((fragment, index) => ({
            key: "sentenceFragment" as const,
            id: item.id + "-fragment-" + String(index),
            label: "SENTENCE #" + String(item.readingOrder) + " F" + String(index),
            rect: clampSemanticRect(fragment),
          }))));
      }

      if (semanticDebugLayer.paragraphs) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "PARAGRAPH")
          .map((item) => ({
            key: "paragraph" as const,
            id: item.id,
            label: "PARAGRAPH #" + String(item.readingOrder),
            rect: clampSemanticRect(item.bounds),
            suffix: item.text,
          })));
      }

      if (semanticDebugLayer.paragraphFragments) {
        objects.push(...semanticObjects
          .filter((item) => item.type === "PARAGRAPH")
          .flatMap((item) => item.fragments.map((fragment, index) => ({
            key: "paragraphFragment" as const,
            id: item.id + "-fragment-" + String(index),
            label: "PARAGRAPH #" + String(item.readingOrder) + " F" + String(index),
            rect: clampSemanticRect(fragment),
          }))));
      }

      if (semanticDebugLayer.readingOrder) {
        objects.push(...model.getLayoutRegions().map((region) => ({
          key: "readingOrder" as const, id: region.id + "-reading-order", label: "REGION #" + String(region.readingOrder),
          rect: clampSemanticRect(region.bounds), suffix: region.layoutType,
        })));
      }
      if (semanticDebugLayer.regionRelations) {
        objects.push(...model.getLayoutRegions().filter((region) => region.relations.length > 0).map((region) => ({
          key: "regionRelation" as const, id: region.id + "-relations", label: "REL #" + String(region.readingOrder),
          rect: clampSemanticRect(region.bounds),
          suffix: region.relations.map((relation) => relation.type + " -> " + relation.targetRegionId).join(", "),
        })));
      }
    }

    if (semanticDebugLayer.candidates) {
      objects.push(
        ...semanticCandidates.flatMap((candidate) =>
          candidate.fragments.map((fragment, index) => ({
            key: "candidate" as const,
            id: candidate.type.toLowerCase() + "-" + candidate.id + "-" + String(index),
            label: candidate.type + " #" + String(candidate.readingOrder) + " (" + candidate.distance.toFixed(4) + ")",
            rect: clampSemanticRect(fragment),
            suffix: candidate.text,
          }))),
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
              key={`${state.document?.id ?? "none"}:${activePageId ?? "none"}:${item.key}:${item.id}`}
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
              {!semanticDebugLayer.boxOnly ? (
                <span
                  className="absolute -left-[2px] -top-[19px] rounded bg-black/70 px-1 text-[10px] font-medium"
                  style={{ color: style.color }}
                >
                  {`${style.label}: ${item.label}`}
                </span>
              ) : null}
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
          {semanticDebugLayer.pdfTextLayer && currentPdfPageContext ? (
            <PdfTextLayerDebug
              key={`${currentPdfPageContext.documentId}:${currentPdfPageContext.pageId}:pdf-text-layer`}
              page={currentPdfPageContext.page}
              pageKey={currentPdfPageContext.pageId}
              zoom={state.zoom}
            />
          ) : null}
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
          {layoutDetectionOverlayNodes}
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
            pageTextDebug={visiblePageText}
            selectedRawTextItem={selectedRawTextItem}
            semanticSource={semanticDebugModel?.getSemanticSource() ?? "-"}
            onSemanticDebugLayerChange={setSemanticDebugLayer}
          />
          <LayoutDetectionDebugPanel
            state={activeLayoutDetectionState}
            catalog={layoutModelCatalog}
            selectedModelId={selectedLayoutModelId}
            visible={layoutDetectionVisible}
            canRun={Boolean(currentPdfPageContext) && state.status === "ready"}
            onModelChange={handleLayoutModelChange}
            onVisibleChange={setLayoutDetectionVisible}
            onRun={() => { void runLayoutDetection(); }}
          />
        </div>
      </div>
    </main>
  );
}

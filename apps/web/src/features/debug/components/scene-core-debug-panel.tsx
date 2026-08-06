"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCanvasSceneObjects,
  buildCompositeRenderSnapshot,
  buildOccupancyMap,
  buildPlacementCandidates,
  buildSceneContext,
  buildSceneSnapshot,
  CanvasObjectStore,
  type CanvasSceneObject,
  type OccupancyPolicy,
  type PlacementCandidate,
  type PdfSceneObject,
  type SceneFocus,
  type SceneMode,
  type SceneObject,
  type ScenePage,
  type SceneSnapshot,
  type SceneSnapshotWithStats,
} from "@ggulnote/editor-core";

interface SceneCoreDebugPanelProps {
  className?: string;
}

const PAGE: ScenePage = {
  id: "page-1",
  index: 0,
  width: 1024,
  height: 1365,
};

const samplePdfObjects = (): PdfSceneObject[] => [
  {
    id: "pdf:sample-doc:0:paragraph:p-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "paragraph",
    bounds: { x: 80, y: 80, width: 560, height: 160 },
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "paragraph:p-1",
    text: "샘플 문단 텍스트입니다.",
    readingOrder: 1,
    childLineIds: ["pdf:sample-doc:0:line:l-1"],
    regionId: "region-1",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:line:l-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "line",
    bounds: { x: 80, y: 80, width: 560, height: 24 },
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "line:l-1",
    text: "샘플 문단 첫 줄",
    readingOrder: 1,
    childWordIds: ["pdf:sample-doc:0:word:w-1", "pdf:sample-doc:0:word:w-2"],
    paragraphId: "pdf:sample-doc:0:paragraph:p-1",
    baseline: 1,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:word:w-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "word",
    bounds: { x: 80, y: 80, width: 80, height: 22 },
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "word:w-1",
    text: "샘플",
    readingOrder: 1,
    lineId: "pdf:sample-doc:0:line:l-1",
    charOffsetStart: 0,
    charOffsetEnd: 2,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:word:w-2",
    pageId: PAGE.id,
    source: "pdf",
    kind: "word",
    bounds: { x: 165, y: 80, width: 72, height: 22 },
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "word:w-2",
    text: "문단",
    readingOrder: 2,
    lineId: "pdf:sample-doc:0:line:l-1",
    charOffsetStart: 3,
    charOffsetEnd: 5,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:table:tbl-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "table",
    bounds: { x: 120, y: 360, width: 560, height: 140 },
    zIndex: 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    rows: 2,
    columns: 2,
    cells: [
      { id: "cell-a", row: 0, column: 0, text: "A" },
      { id: "cell-b", row: 0, column: 1, text: "B" },
      { id: "cell-c", row: 1, column: 0, text: "C" },
      { id: "cell-d", row: 1, column: 1, text: "D" },
    ],
    rowHeights: [30, 30],
    columnWidths: [60, 60],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:image:img-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "image",
    bounds: { x: 700, y: 120, width: 240, height: 160 },
    zIndex: 2,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "img-1",
    imageId: "img-1",
    imageSource: "pdf-fig",
    sourceAssetId: "asset:pdf:img-1",
    assetUrl: "https://example.com/pdf-image.png",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "pdf:sample-doc:0:pdf-region:r-1",
    pageId: PAGE.id,
    source: "pdf",
    kind: "pdf-region",
    bounds: { x: 64, y: 64, width: 700, height: 500 },
    zIndex: -1,
    visible: true,
    locked: false,
    objectRevision: 1,
    regionId: "r-1",
    regionType: "region",
    regionBounds: { x: 64, y: 64, width: 700, height: 500 },
    relatedSemanticObjectIds: ["pdf:sample-doc:0:paragraph:p-1", "pdf:sample-doc:0:line:l-1"],
    pageIndex: 0,
    confidence: 0.9,
    sourceRef: "yolo",
    createdAt: 0,
    updatedAt: 0,
  },
];

const createCanvasStoreObjects = (): CanvasObjectStore => {
  const store = new CanvasObjectStore({ idGenerator: createDeterministicIdGenerator() });

  const text = store.createObject({
    source: "canvas",
    kind: "text",
    pageId: PAGE.id,
    bounds: { x: 180, y: 700, width: 180, height: 40 },
    zIndex: 5,
    visible: true,
    locked: false,
    text: "사용자 메모",
    style: { fontSize: 16, fontFamily: "system-ui", textAlign: "left" },
  });

  const math = store.createObject({
    source: "canvas",
    kind: "math",
    pageId: PAGE.id,
    bounds: { x: 420, y: 700, width: 220, height: 48 },
    zIndex: 6,
    visible: true,
    locked: false,
    latex: "x + y = z",
    layout: "display",
    mathJson: { type: "eq" },
  });

  const graph = store.createObject({
    source: "canvas",
    kind: "graph",
    pageId: PAGE.id,
    bounds: { x: 180, y: 760, width: 460, height: 220 },
    zIndex: 7,
    visible: true,
    locked: false,
    expressions: [{ id: "e1", expression: "y = x^2" }],
    viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
    showAxes: true,
    showGrid: true,
  });

  const table = store.createObject({
    source: "canvas",
    kind: "table",
    pageId: PAGE.id,
    bounds: { x: 700, y: 700, width: 260, height: 110 },
    zIndex: 8,
    visible: true,
    locked: false,
    rows: 2,
    columns: 2,
    cells: [
      { id: "canvas-cell-a", row: 0, column: 0, text: "1" },
      { id: "canvas-cell-b", row: 0, column: 1, text: "2" },
      { id: "canvas-cell-c", row: 1, column: 0, text: "3" },
      { id: "canvas-cell-d", row: 1, column: 1, text: "4" },
    ],
  });

  const shape = store.createObject({
    source: "canvas",
    kind: "shape",
    pageId: PAGE.id,
    bounds: { x: 170, y: 1000, width: 140, height: 90 },
    zIndex: 9,
    visible: true,
    locked: false,
    shapeType: "rectangle",
    geometry: {
      kind: "rectangle",
      x: 170,
      y: 1000,
      width: 140,
      height: 90,
    },
    style: {
      stroke: "#f97316",
      fill: "rgba(249,115,22,0.16)",
      strokeWidth: 2,
      opacity: 0.9,
    },
  });

  const annotation = store.createObject({
    source: "canvas",
    kind: "annotation",
    pageId: PAGE.id,
    bounds: { x: 700, y: 980, width: 200, height: 110 },
    zIndex: 10,
    visible: true,
    locked: false,
    annotationType: "highlight",
    targetObjectIds: [text.id, math.id],
    style: {
      color: "#f59e0b",
      opacity: 0.35,
      thickness: 8,
    },
  });

  const image = store.createObject({
    source: "canvas",
    kind: "image",
    pageId: PAGE.id,
    bounds: { x: 680, y: 1080, width: 120, height: 80 },
    zIndex: 11,
    visible: true,
    locked: false,
    sourceObjectId: "cimg-1",
    imageId: "img-canvas-1",
    sourceAssetId: "asset:canvas:img-1",
    assetUrl: "https://example.com/asset.png",
  });

  const group = store.createObject({
    source: "canvas",
    kind: "group",
    pageId: PAGE.id,
    bounds: { x: 160, y: 680, width: 540, height: 320 },
    zIndex: 12,
    visible: true,
    locked: false,
    childIds: [text.id, math.id, graph.id],
  });

  const arrow = store.createObject({
    source: "canvas",
    kind: "shape",
    pageId: PAGE.id,
    bounds: { x: 360, y: 560, width: 120, height: 60 },
    zIndex: 13,
    visible: true,
    locked: false,
    shapeType: "arrow",
    geometry: {
      kind: "arrow",
      start: { x: 360, y: 560 },
      end: { x: 420, y: 620 },
      headSize: 10,
    },
    style: {
      stroke: "#0284c7",
      strokeWidth: 2,
    },
  });

  store.createObject({
    source: "canvas",
    kind: "shape",
    pageId: PAGE.id,
    bounds: { x: 500, y: 560, width: 120, height: 60 },
    zIndex: 14,
    visible: true,
    locked: false,
    shapeType: "line",
    geometry: {
      kind: "line",
      start: { x: 500, y: 560 },
      end: { x: 620, y: 620 },
    },
    style: {
      stroke: "#16a34a",
      strokeWidth: 2,
    },
  });

  return store;
};

const createDeterministicIdGenerator = () => {
  let i = 1;
  return () => `id-${String(i++).padStart(4, "0")}`;
};

const createPolicy = (): OccupancyPolicy => ({
  includeInvisible: false,
  includeAnnotations: true,
  annotationBlockingTypes: ["highlight", "box"],
  padding: 4,
  minimumBlockingSize: { width: 4, height: 4 },
});

const createSceneRevision = (): number => 120;

const buildDemoCompositeImage = () => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width}" height="${PAGE.height}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">
    <rect x="0" y="0" width="${PAGE.width}" height="${PAGE.height}" fill="#fff" />
    <text x="20" y="40" font-size="16" fill="#334155">Scene Composite Demo</text>
    <rect x="180" y="80" width="560" height="160" stroke="#0284c7" fill="rgba(14,165,233,0.08)" />
  </svg>
`;

const fakeRendererImage = `data:image/svg+xml;utf8,${encodeURIComponent(buildDemoCompositeImage())}`;

export function SceneCoreDebugPanel({ className = "" }: SceneCoreDebugPanelProps): React.ReactElement {
  const [mode, setMode] = useState<SceneMode>("pdf");
  const [simulateRevisionChange, setSimulateRevisionChange] = useState(false);
  const [compositeState, setCompositeState] = useState<string>("loading");

  const canvasStore = useMemo(() => createCanvasStoreObjects(), []);
  const canvasSceneObjects = useMemo(() => {
    const output = buildCanvasSceneObjects({
      pageId: PAGE.id,
      pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
      store: canvasStore,
    });
    return output.objects as CanvasSceneObject[];
  }, [canvasStore]);

  const occupancyPolicy = useMemo(() => createPolicy(), []);

  const snapshot = useMemo<SceneSnapshotWithStats>(() => {
    const sceneObjects = mode === "pdf"
      ? [...samplePdfObjects(), ...canvasSceneObjects]
      : canvasSceneObjects;

    return buildSceneSnapshot({
      mode,
      page: PAGE,
      sceneRevision: createSceneRevision(),
      pdfObjects: mode === "pdf" ? samplePdfObjects() : [],
      canvasObjects: canvasSceneObjects,
    });
  }, [mode, canvasSceneObjects]);

  const focus: SceneFocus | undefined = snapshot.objects.length > 0
    ? {
      objectId: snapshot.objects[0]?.id,
    }
    : undefined;

  const context = useMemo(() => {
    return buildSceneContext({
      sceneRevision: snapshot.sceneRevision,
      mode,
      page: PAGE,
      objects: snapshot.objects,
      focusObjectId: focus?.objectId,
      occupancyPolicy,
      placementMaxCandidates: 8,
      placementMinimumWidth: 10,
      placementMinimumHeight: 10,
    });
  }, [snapshot, mode, focus?.objectId, occupancyPolicy]);

  const candidates = context.placementCandidates;

  useEffect(() => {
    let mounted = true;

    const build = async () => {
      setCompositeState("loading");
      const result = await buildCompositeRenderSnapshot({
        pageId: PAGE.id,
        page: PAGE,
        sceneRevision: snapshot.sceneRevision,
        renderImage: async () => fakeRendererImage,
        getCurrentSceneRevision: () => simulateRevisionChange ? snapshot.sceneRevision + 1 : snapshot.sceneRevision,
      });

      if (!mounted) {
        return;
      }

      if (result.snapshot) {
        setCompositeState(JSON.stringify({
          sceneRevision: result.snapshot.sceneRevision,
          pageId: result.snapshot.pageId,
          width: result.snapshot.width,
          height: result.snapshot.height,
          stale: result.snapshot.stale,
          generatedAt: result.snapshot.generatedAt,
        }, null, 2));
      } else {
        setCompositeState(`failure: ${String((result.failure as { error: unknown } | undefined)?.error ?? "unknown")}`);
      }
    };

    void build();

    return () => {
      mounted = false;
    };
  }, [snapshot.sceneRevision, simulateRevisionChange]);

  const objectCounts = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const object of snapshot.objects as SceneObject[]) {
      stats[object.kind] = (stats[object.kind] ?? 0) + 1;
    }
    return stats;
  }, [snapshot.objects]);

  const candidateRows = candidates.slice(0, 6).map((candidate: PlacementCandidate) => {
    return {
      id: candidate.id,
      relation: candidate.relation,
      score: candidate.score.toFixed(2),
      area: candidate.area.toFixed(2),
      bounds: candidate.bounds,
      nearby: candidate.nearbyObjectIds.join(", "),
    };
  });

  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Scene Core Debug</h2>
          <p className="text-xs text-slate-500">현재 페이지의 SceneSnapshot/Placement/Occupancy 정보를 확인합니다.</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === "pdf" ? "blank" : "pdf"))}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs"
          >
            모드 전환
          </button>
          <button
            type="button"
            onClick={() => setSimulateRevisionChange((prev) => !prev)}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs"
          >
            snapshot stale 토글
          </button>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt>Scene Mode</dt>
          <dd>{mode}</dd>
        </div>
        <div>
          <dt>Scene Revision</dt>
          <dd>{snapshot.sceneRevision}</dd>
        </div>
        <div>
          <dt>Page ID</dt>
          <dd>{snapshot.page.id}</dd>
        </div>
        <div>
          <dt>페이지 크기</dt>
          <dd>{snapshot.page.width} × {snapshot.page.height}</dd>
        </div>
        <div>
          <dt>총 객체 수</dt>
          <dd>{snapshot.objects.length}</dd>
        </div>
        <div>
          <dt>PDF 객체 수</dt>
          <dd>{snapshot.objects.filter((entry) => entry.source === "pdf").length}</dd>
        </div>
        <div>
          <dt>Canvas 객체 수</dt>
          <dd>{snapshot.objects.filter((entry) => entry.source === "canvas").length}</dd>
        </div>
      </dl>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">유형별 객체 수</h3>
        <ul className="mt-2 text-sm">
          {Object.entries(objectCounts).map(([kind, count]) => (
            <li key={kind} className="grid grid-cols-2 border-b border-slate-100 py-1">
              <span className="text-slate-500">{kind}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Occupancy Map</h3>
        <pre className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
          {JSON.stringify(context.occupancyMap, null, 2)}
        </pre>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Placement Candidates</h3>
        <ul className="mt-2 text-sm">
          {candidateRows.map((candidate) => (
            <li key={candidate.id} className="mb-2 rounded border border-slate-200 p-2 text-xs">
              <div>ID: {candidate.id}</div>
              <div>relation: {candidate.relation}</div>
              <div>score: {candidate.score}</div>
              <div>area: {candidate.area}</div>
              <div>
                bounds: x={candidate.bounds.x}, y={candidate.bounds.y}, w={candidate.bounds.width}, h={candidate.bounds.height}
              </div>
              <div>nearby: {candidate.nearby || "-"}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Composite Render Snapshot</h3>
        <pre className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
          {compositeState}
        </pre>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Objects</h3>
        <pre className="mt-2 max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
          {JSON.stringify(snapshot.objects, null, 2)}
        </pre>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Scene Snapshot</h3>
        <pre className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </section>
    </section>
  );
}

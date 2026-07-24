import type { SemanticCandidate } from "@ggulnote/document-core";
import type {
  NormalizedPoint,
  PageTextContent,
  RawPdfTextItemDebug,
} from "../model/document-types";
import type { DocumentSessionState } from "../model/document-state";

export type SemanticDebugLayerState = {
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

type DocumentDebugPanelProps = {
  state: DocumentSessionState;
  documentName: string;
  pointer: NormalizedPoint | null;
  semanticDebugLayer: SemanticDebugLayerState;
  semanticCandidates: SemanticCandidate[];
  pageTextDebug: PageTextContent | null;
  selectedRawTextItem: RawPdfTextItemDebug | null;
  semanticSource: string;
  onSemanticDebugLayerChange: (next: SemanticDebugLayerState) => void;
};

function shortenText(value: string, maxLength = 30): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength) + "...";
}

export function DocumentDebugPanel({
  state,
  documentName,
  pointer,
  semanticDebugLayer,
  semanticCandidates,
  pageTextDebug,
  selectedRawTextItem,
  semanticSource,
  onSemanticDebugLayerChange,
}: DocumentDebugPanelProps): React.ReactElement {
  const selectedCandidate = semanticCandidates[0] ?? null;
  const summary = pageTextDebug?.summary ?? null;

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4" aria-label="문서 디버그 패널">
      <h2 className="text-sm font-semibold text-slate-700">문서 상태</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="font-medium text-slate-600">저장 상태</dt><dd>{state.persistenceSaveStatus}</dd></div>
        <div><dt className="font-medium text-slate-600">저장 오류</dt><dd>{state.persistenceSaveErrorMessage ?? "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">문서 종류</dt><dd>{state.document?.kind ?? "none"}</dd></div>
        <div><dt className="font-medium text-slate-600">문서명</dt><dd>{documentName}</dd></div>
        <div><dt className="font-medium text-slate-600">문서 상태</dt><dd>{state.status}</dd></div>
        <div><dt className="font-medium text-slate-600">현재 페이지</dt><dd>{state.totalPages === 0 ? "-" : state.currentPage}</dd></div>
        <div><dt className="font-medium text-slate-600">총 페이지</dt><dd>{state.totalPages}</dd></div>
        <div><dt className="font-medium text-slate-600">현재 줌</dt><dd>{state.zoom}%</dd></div>
        <div><dt className="font-medium text-slate-600">줌 모드</dt><dd>{state.zoomMode}</dd></div>
        <div><dt className="font-medium text-slate-600">원본 페이지 너비</dt><dd>{state.page?.width ? state.page.width.toFixed(2) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">원본 페이지 높이</dt><dd>{state.page?.height ? state.page.height.toFixed(2) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">렌더링 너비</dt><dd>{state.renderedWidth > 0 ? state.renderedWidth.toFixed(2) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">렌더링 높이</dt><dd>{state.renderedHeight > 0 ? state.renderedHeight.toFixed(2) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">현재 포인터 X</dt><dd>{pointer ? pointer.x.toFixed(4) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">현재 포인터 Y</dt><dd>{pointer ? pointer.y.toFixed(4) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Text Item 개수</dt><dd>{state.textItemCount}</dd></div>
        <div><dt className="font-medium text-slate-600">Text 요청 ID</dt><dd>{pageTextDebug?.requestId ?? "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Text 결과 소스</dt><dd>{pageTextDebug?.source ?? "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Canonical viewport</dt><dd>{pageTextDebug ? `${pageTextDebug.viewport.width.toFixed(2)} x ${pageTextDebug.viewport.height.toFixed(2)} / ${pageTextDebug.viewport.rotation}deg` : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Empty / Invalid / Rotated / Out</dt><dd>{summary ? `${summary.emptyItemCount} / ${summary.invalidBoundsCount} / ${summary.rotatedItemCount} / ${summary.outOfPageBoundsCount}` : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Semantic 상태</dt><dd>{state.semanticStatus}</dd></div>
        <div><dt className="font-medium text-slate-600">Cache 상태</dt><dd>{state.semanticCacheStatus}</dd></div>
        <div><dt className="font-medium text-slate-600">Extractor / Schema</dt><dd>{state.semanticExtractorVersion} / {state.semanticSchemaVersion}</dd></div>
        <div><dt className="font-medium text-slate-600">Semantic source</dt><dd>{semanticSource}</dd></div>
        <div><dt className="font-medium text-slate-600">처리 소스 개수</dt><dd>{state.semanticSourceItemCount}</dd></div>
        <div><dt className="font-medium text-slate-600">Word / Line / Sentence / Paragraph</dt><dd>{state.semanticWordCount} / {state.semanticLineCount} / {state.semanticSentenceCount} / {state.semanticParagraphCount}</dd></div>
        <div><dt className="font-medium text-slate-600">Region / Block / Column</dt><dd>{state.semanticRegionCount} / {state.semanticBlockCount} / {state.semanticColumnCount}</dd></div>
        <div><dt className="font-medium text-slate-600">처리 시간(ms)</dt><dd>{state.semanticProcessingDurationMs}</dd></div>
        <div><dt className="font-medium text-slate-600">선택 Semantic</dt><dd>{state.semanticSelectedType}</dd></div>
        <div><dt className="font-medium text-slate-600">선택 ID</dt><dd>{state.semanticSelectedId}</dd></div>
        <div><dt className="font-medium text-slate-600">선택 텍스트</dt><dd>{state.semanticSelectedText ? shortenText(state.semanticSelectedText, 40) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">후보 개수</dt><dd>{state.semanticCandidateCount}</dd></div>
        <div><dt className="font-medium text-slate-600">최단 거리</dt><dd>{state.semanticNearestDistance === null ? "-" : state.semanticNearestDistance.toFixed(4)}</dd></div>
        <div><dt className="font-medium text-slate-600">Direct hit</dt><dd>{selectedCandidate ? String(selectedCandidate.directHit) : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Region / Block / Column ID</dt><dd className="break-all">{selectedCandidate ? selectedCandidate.regionId + " / " + selectedCandidate.blockId + " / " + selectedCandidate.columnId : "-"}</dd></div>
        <div><dt className="font-medium text-slate-600">Fragment 개수</dt><dd>{selectedCandidate?.fragments.length ?? 0}</dd></div>
      </dl>

      <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-sm">
        <h3 className="font-medium text-slate-600">Semantic Debug Layer</h3>
        {([
          { key: "pdfTextLayer", label: "PDF.js Text Layer" },
          { key: "rawTextItems", label: "Raw PDF.js Text Item" },
          { key: "textItems", label: "Normalized Text Item" },
          { key: "words", label: "Word" },
          { key: "regionWords", label: "Region assigned Word" },
          { key: "unassignedWords", label: "Unassigned Word" },
          { key: "lines", label: "Line" },
          { key: "layoutRegions", label: "LayoutRegion" },
          { key: "layoutBlocks", label: "LayoutBlock" },
          { key: "columns", label: "Column" },
          { key: "sentences", label: "Sentence bounds" },
          { key: "sentenceFragments", label: "Sentence fragments" },
          { key: "paragraphs", label: "Paragraph bounds" },
          { key: "paragraphFragments", label: "Paragraph fragments" },
          { key: "readingOrder", label: "Region Reading Order" },
          { key: "regionRelations", label: "Caption / Section relations" },
          { key: "candidates", label: "Candidate" },
          { key: "boxOnly", label: "바운딩 박스만 보기" },
        ] as const).map((item) => (
          <label key={item.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={semanticDebugLayer[item.key]}
              onChange={(event) => onSemanticDebugLayerChange({
                ...semanticDebugLayer,
                [item.key]: event.currentTarget.checked,
              })}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
        <h3 className="font-medium text-slate-600">Raw Text Item hover</h3>
        {selectedRawTextItem ? (
          <dl className="mt-2 space-y-1 text-xs">
            <div><dt className="font-medium">ID 범위</dt><dd className="break-all">{selectedRawTextItem.documentId} / {selectedRawTextItem.pageId} / {selectedRawTextItem.sourceIndex}</dd></div>
            <div><dt className="font-medium">텍스트</dt><dd>{shortenText(selectedRawTextItem.str, 50)}</dd></div>
            <div><dt className="font-medium">transform</dt><dd className="break-all">{selectedRawTextItem.transform.join(", ")}</dd></div>
            <div><dt className="font-medium">PDF width / height</dt><dd>{selectedRawTextItem.width.toFixed(3)} / {selectedRawTextItem.height.toFixed(3)}</dd></div>
            <div><dt className="font-medium">font / dir / EOL</dt><dd>{selectedRawTextItem.fontName || "-"} / {selectedRawTextItem.dir || "-"} / {String(selectedRawTextItem.hasEOL)}</dd></div>
            <div><dt className="font-medium">ascent / descent</dt><dd>{selectedRawTextItem.style.ascent ?? "-"} / {selectedRawTextItem.style.descent ?? "-"}</dd></div>
            <div><dt className="font-medium">angle</dt><dd>{selectedRawTextItem.computed.angle.toFixed(5)}</dd></div>
            <div><dt className="font-medium">pixel bounds</dt><dd>{selectedRawTextItem.computed.x.toFixed(2)}, {selectedRawTextItem.computed.y.toFixed(2)}, {selectedRawTextItem.computed.width.toFixed(2)}, {selectedRawTextItem.computed.height.toFixed(2)}</dd></div>
            <div><dt className="font-medium">normalized bounds</dt><dd>{Object.values(selectedRawTextItem.computed.normalizedBounds).map((value) => value.toFixed(5)).join(", ")}</dd></div>
          </dl>
        ) : <p className="text-slate-600">Raw Text Item 위에 포인터를 올리세요.</p>}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
        <h3 className="font-medium text-slate-600">후보</h3>
        {semanticCandidates.length === 0 ? <p className="text-slate-600">후보 없음</p> : (
          <ul className="mt-2 space-y-1">
            {semanticCandidates.slice(0, 5).map((candidate, index) => (
              <li key={candidate.type + "-" + candidate.id + "-" + String(index)} className="rounded border border-slate-100 p-2">
                <div className="font-medium">
                  {candidate.type}
                  {candidate.layoutType ? ` · ${candidate.layoutType}` : ""}
                  {" "}#{candidate.readingOrder}
                </div>
                <div>{shortenText(candidate.text)}</div>
                <div className="text-xs text-slate-500">{candidate.directHit ? "direct" : "nearest"} / 거리 {candidate.distance.toFixed(4)} / fragments {candidate.fragments.length}</div>
                <div className="break-all text-xs text-slate-500">
                  region {candidate.regionId}
                  {candidate.blockId ? ` / block ${candidate.blockId}` : ""}
                  {candidate.columnId ? ` / column ${candidate.columnId}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
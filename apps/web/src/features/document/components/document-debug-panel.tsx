import type { SemanticCandidate } from "@ggulnote/document-core";
import type { NormalizedPoint } from "../model/document-types";
import type { DocumentSessionState } from "../model/document-state";

type SemanticDebugLayerState = {
  textItems: boolean;
  words: boolean;
  lines: boolean;
  layoutRegions: boolean;
  layoutBlocks: boolean;
  columns: boolean;
  sentences: boolean;
  sentenceFragments: boolean;
  paragraphs: boolean;
  paragraphFragments: boolean;
  readingOrder: boolean;
  candidates: boolean;
  boxOnly: boolean;
};

type DocumentDebugPanelProps = {
  state: DocumentSessionState;
  documentName: string;
  pointer: NormalizedPoint | null;
  semanticDebugLayer: SemanticDebugLayerState;
  semanticCandidates: SemanticCandidate[];
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
  onSemanticDebugLayerChange,
}: DocumentDebugPanelProps): React.ReactElement {
  const selectedCandidate = semanticCandidates[0] ?? null;

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
        <div><dt className="font-medium text-slate-600">Semantic 상태</dt><dd>{state.semanticStatus}</dd></div>
        <div><dt className="font-medium text-slate-600">Cache 상태</dt><dd>{state.semanticCacheStatus}</dd></div>
        <div><dt className="font-medium text-slate-600">Extractor / Schema</dt><dd>{state.semanticExtractorVersion} / {state.semanticSchemaVersion}</dd></div>
        <div><dt className="font-medium text-slate-600">처리 소스 개수</dt><dd>{state.semanticSourceItemCount}</dd></div>
        <div>
          <dt className="font-medium text-slate-600">Word / Line / Sentence / Paragraph</dt>
          <dd>{state.semanticWordCount} / {state.semanticLineCount} / {state.semanticSentenceCount} / {state.semanticParagraphCount}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">Region / Block / Column</dt>
          <dd>{state.semanticRegionCount} / {state.semanticBlockCount} / {state.semanticColumnCount}</dd>
        </div>
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
          { key: "textItems", label: "Text Item" },
          { key: "words", label: "Word" },
          { key: "lines", label: "Line" },
          { key: "layoutRegions", label: "LayoutRegion" },
          { key: "layoutBlocks", label: "LayoutBlock" },
          { key: "columns", label: "Column" },
          { key: "sentences", label: "Sentence bounds" },
          { key: "sentenceFragments", label: "Sentence fragments" },
          { key: "paragraphs", label: "Paragraph bounds" },
          { key: "paragraphFragments", label: "Paragraph fragments" },
          { key: "readingOrder", label: "Reading Order" },
          { key: "candidates", label: "Candidate" },
          { key: "boxOnly", label: "바운딩 박스만 보기" },
        ] as const).map((item) => (
          <label key={item.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={semanticDebugLayer[item.key]}
              onChange={(event) => {
                onSemanticDebugLayerChange({
                  ...semanticDebugLayer,
                  [item.key]: event.currentTarget.checked,
                });
              }}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
        <h3 className="font-medium text-slate-600">후보</h3>
        {semanticCandidates.length === 0 ? (
          <p className="text-slate-600">후보 없음</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {semanticCandidates.slice(0, 5).map((candidate, index) => (
              <li key={candidate.type + "-" + candidate.id + "-" + String(index)} className="rounded border border-slate-100 p-2">
                <div className="font-medium">{candidate.type} #{candidate.readingOrder}</div>
                <div>{shortenText(candidate.text)}</div>
                <div className="text-xs text-slate-500">
                  {candidate.directHit ? "direct" : "nearest"} / 거리 {candidate.distance.toFixed(4)} / fragments {candidate.fragments.length}
                </div>
                <div className="break-all text-xs text-slate-500">block {candidate.blockId} / column {candidate.columnId}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

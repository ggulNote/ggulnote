import type { NormalizedPoint } from "../model/document-types";
import type { DocumentSessionState } from "../model/document-state";

type DebugPanelProps = {
  state: DocumentSessionState;
  documentName: string;
  pointer: NormalizedPoint | null;
};

export function DocumentDebugPanel({ state, documentName, pointer }: DebugPanelProps): React.ReactElement {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4" aria-label="문서 디버그 패널">
      <h2 className="text-sm font-semibold text-slate-700">문서 상태</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-medium text-slate-600">저장 상태</dt>
          <dd>{state.persistenceSaveStatus}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">저장 오류</dt>
          <dd>{state.persistenceSaveErrorMessage ?? "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">문서 종류</dt>
          <dd>{state.document?.kind ?? "none"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">문서명</dt>
          <dd>{documentName}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">문서 상태</dt>
          <dd>{state.status}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">현재 페이지</dt>
          <dd>{state.totalPages === 0 ? "-" : state.currentPage}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">총 페이지</dt>
          <dd>{state.totalPages}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">현재 줌</dt>
          <dd>{state.zoom}%</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">줌 모드</dt>
          <dd>{state.zoomMode}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">원본 페이지 너비</dt>
          <dd>{state.page?.width ? state.page.width.toFixed(2) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">원본 페이지 높이</dt>
          <dd>{state.page?.height ? state.page.height.toFixed(2) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">렌더링 너비</dt>
          <dd>{state.renderedWidth > 0 ? state.renderedWidth.toFixed(2) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">렌더링 높이</dt>
          <dd>{state.renderedHeight > 0 ? state.renderedHeight.toFixed(2) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">현재 포인터 X</dt>
          <dd>{pointer ? pointer.x.toFixed(4) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">현재 포인터 Y</dt>
          <dd>{pointer ? pointer.y.toFixed(4) : "-"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">Text Item 개수</dt>
          <dd>{state.textItemCount}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">PDF.js 준비</dt>
          <dd>{state.isPdfJsReady ? "loaded" : "not loaded"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">PDF Worker 준비</dt>
          <dd>{state.isPdfWorkerReady ? "loaded" : "not loaded"}</dd>
        </div>
      </dl>
    </aside>
  );
}

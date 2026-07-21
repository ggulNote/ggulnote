type DebugPayload = {
  documentKind: string;
  documentStatus: string;
  documentName: string;
  currentPage: string;
  pageCount: string;
  zoom: string;
  zoomMode: string;
  originalWidth: string;
  originalHeight: string;
  renderedWidth: string;
  renderedHeight: string;
  pointerX: string;
  pointerY: string;
  textItemCount: string;
  pdfJsLoaded: string;
  pdfWorkerLoaded: string;
};

type ModuleState = {
  name: string;
  status: "준비 중" | "미구현";
};

type DebugDashboardProps = {
  environment: string;
  nextStatus: string;
  moduleStatus: ModuleState[];
  roadmap: string[];
  payload: DebugPayload;
};

export function DebugDashboard({
  environment,
  nextStatus,
  moduleStatus,
  roadmap,
  payload,
}: DebugDashboardProps): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <h1 className="text-3xl font-semibold text-slate-900">디버그 대시보드</h1>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase text-slate-500">실행 상태</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="font-semibold">환경</dt>
              <dd>{environment}</dd>
            </div>
            <div>
              <dt className="font-semibold">현재 경로</dt>
              <dd>/debug</dd>
            </div>
            <div>
              <dt className="font-semibold">Next.js 앱 상태</dt>
              <dd>{nextStatus}</dd>
            </div>
          </dl>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase text-slate-500">모듈 상태</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {moduleStatus.map((module) => (
              <li key={module.name} className="flex items-center justify-between gap-3">
                <span>{module.name}</span>
                <span className="text-xs uppercase tracking-wide text-slate-500">{module.status}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase text-slate-500">문서 상태</h2>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt>문서 종류</dt>
            <dd>{payload.documentKind}</dd>
          </div>
          <div>
            <dt>문서 상태</dt>
            <dd>{payload.documentStatus}</dd>
          </div>
          <div>
            <dt>문서명</dt>
            <dd>{payload.documentName}</dd>
          </div>
          <div>
            <dt>현재 페이지</dt>
            <dd>{payload.currentPage}</dd>
          </div>
          <div>
            <dt>총 페이지</dt>
            <dd>{payload.pageCount}</dd>
          </div>
          <div>
            <dt>현재 줌</dt>
            <dd>{payload.zoom}</dd>
          </div>
          <div>
            <dt>Zoom 모드</dt>
            <dd>{payload.zoomMode}</dd>
          </div>
          <div>
            <dt>원본 페이지 너비</dt>
            <dd>{payload.originalWidth}</dd>
          </div>
          <div>
            <dt>원본 페이지 높이</dt>
            <dd>{payload.originalHeight}</dd>
          </div>
          <div>
            <dt>렌더링 너비</dt>
            <dd>{payload.renderedWidth}</dd>
          </div>
          <div>
            <dt>렌더링 높이</dt>
            <dd>{payload.renderedHeight}</dd>
          </div>
          <div>
            <dt>현재 포인터 X</dt>
            <dd>{payload.pointerX}</dd>
          </div>
          <div>
            <dt>현재 포인터 Y</dt>
            <dd>{payload.pointerY}</dd>
          </div>
          <div>
            <dt>Text Item 개수</dt>
            <dd>{payload.textItemCount}</dd>
          </div>
          <div>
            <dt>PDF.js 로딩</dt>
            <dd>{payload.pdfJsLoaded}</dd>
          </div>
          <div>
            <dt>PDF Worker 로딩</dt>
            <dd>{payload.pdfWorkerLoaded}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase text-slate-500">향후 모듈 목록</h2>
        <ul className="mt-3 list-disc pl-6 text-sm text-slate-700">
          {roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

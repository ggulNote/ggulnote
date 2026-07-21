import type { ReactNode } from "react";

type EngineStatusRow = {
  label: string;
  status: string;
};

type ModuleState = {
  name: string;
  status: "미구현" | "준비 중";
};

const engineStates: EngineStatusRow[] = [
  { label: "문서명", status: "placeholder" },
  { label: "현재 상태", status: "준비 중" },
];

const moduleList: ModuleState[] = [
  { name: "Document Engine", status: "미구현" },
  { name: "Editor Engine", status: "미구현" },
  { name: "Gaze Engine", status: "미구현" },
  { name: "Voice Engine", status: "미구현" },
  { name: "Intent Engine", status: "미구현" },
];

function Panel({
  children,
  title,
  ariaLabel,
}: {
  children: ReactNode;
  title: string;
  ariaLabel?: string;
}) {
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-label={ariaLabel}
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="text-sm text-slate-800">{children}</div>
    </section>
  );
}

export function EditorShell(): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <header className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">꿀노트</h1>
            <p className="text-sm text-slate-600">문서명 placeholder</p>
          </div>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600">
            현재 상태: 준비 중
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {engineStates.map((item) => (
            <div key={item.label} className="text-sm">
              <dt className="font-semibold text-slate-500">{item.label}</dt>
              <dd>{item.status}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
        <Panel title="왼쪽 페이지 패널" ariaLabel="왼쪽 페이지 패널">
          <p>페이지 목록 placeholder입니다.</p>
        </Panel>

        <Panel title="문서 영역" ariaLabel="문서 영역">
          <div className="flex min-h-[260px] w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
            <p>다음 단계에서 PDF 및 백지 뷰어를 구현합니다.</p>
          </div>
        </Panel>

        <Panel title="오른쪽 상태 패널" ariaLabel="오른쪽 상태 패널">
          <ul className="space-y-2">
            {moduleList.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-2">
                <span>{item.name}</span>
                <span className="text-xs font-semibold uppercase text-slate-500">{item.status}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            <button type="button" disabled className="w-full rounded border border-slate-400 px-3 py-2 text-sm">
              PDF 렌더링 시작 (준비 중)
            </button>
            <button type="button" disabled className="w-full rounded border border-slate-400 px-3 py-2 text-sm">
              캔버스 도구 시작 (준비 중)
            </button>
          </div>
        </Panel>
      </div>
    </main>
  );
}

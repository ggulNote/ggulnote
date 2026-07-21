import type { ReactElement } from "react";

type ModuleState = {
  name: string;
  status: "미구현" | "준비 중";
};

type DebugPayload = {
  page: string;
  gazeCoordinate: string;
  roi: string;
  candidateCount: string;
  actionPlan: string;
  canvasObjects: string;
};

type DebugProps = {
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
}: DebugProps): ReactElement {
  return (
    <main className="mx-auto w-full max-w-5xl p-4 md:p-8">
      <h1 className="text-3xl font-semibold text-slate-900">디버그 대시보드</h1>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="runtime-title">
          <h2 id="runtime-title" className="text-sm font-semibold uppercase text-slate-500">실행 상태</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="font-semibold">실행 환경</dt>
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

        <article className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="module-title">
          <h2 id="module-title" className="text-sm font-semibold uppercase text-slate-500">모듈 준비 상태</h2>
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

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="roadmap-title">
        <h2 id="roadmap-title" className="text-sm font-semibold uppercase text-slate-500">향후 모듈 목록</h2>
        <ul className="mt-3 list-disc pl-6 text-sm text-slate-700">
          {roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="placeholder-title">
        <h2 id="placeholder-title" className="text-sm font-semibold uppercase text-slate-500">테스트용 placeholder 데이터</h2>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold">현재 페이지</dt>
            <dd>{payload.page}</dd>
          </div>
          <div>
            <dt className="font-semibold">시선 좌표</dt>
            <dd>{payload.gazeCoordinate}</dd>
          </div>
          <div>
            <dt className="font-semibold">ROI</dt>
            <dd>{payload.roi}</dd>
          </div>
          <div>
            <dt className="font-semibold">후보 객체 수</dt>
            <dd>{payload.candidateCount}</dd>
          </div>
          <div>
            <dt className="font-semibold">Action Plan</dt>
            <dd>{payload.actionPlan}</dd>
          </div>
          <div>
            <dt className="font-semibold">Canvas 객체 수</dt>
            <dd>{payload.canvasObjects}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

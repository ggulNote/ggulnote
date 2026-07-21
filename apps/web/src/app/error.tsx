"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[220px] w-full max-w-5xl flex-col items-start justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">앱 처리 중 오류가 발생했습니다.</h1>
      <p className="text-slate-600">문제가 계속되면 잠시 후 다시 시도해 주세요.</p>
      <button
        type="button"
        className="rounded-md border border-slate-800 px-4 py-2"
        onClick={() => reset()}
      >
        다시 시도
      </button>
    </main>
  );
}

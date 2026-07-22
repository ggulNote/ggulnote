import Link from "next/link";

export function LandingPageContent(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <header className="mb-10 space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">GGULNOTE</p>
        <h1 className="text-4xl font-bold text-slate-900">꿀노트</h1>
      </header>

      <p className="text-lg leading-7 text-slate-700">
        시선과 음성으로 사용하는 핸즈프리 필기 앱
      </p>

      <p className="mt-4 max-w-2xl text-slate-600">
        꿀노트는 1단계 기반 환경과 기본 화면 뼈대를 구성한 초기 단계입니다. 실제 PDF/백지 뷰어,
        시선 추적, 음성 제어 기능은 다음 단계에서 추가됩니다.
      </p>

      <section className="mt-10 flex flex-wrap gap-3" aria-label="주요 이동 링크">
        <a
          href="/editor"
          aria-label="에디터 페이지 이동"
          className="rounded-md border border-slate-900 px-5 py-3 font-medium text-slate-900 transition-colors hover:bg-slate-900 hover:text-white"
        >
          /editor로 이동
        </a>
        <Link
          href="/debug"
          aria-label="디버그 페이지 이동"
          className="rounded-md border border-slate-300 px-5 py-3 font-medium text-slate-800 transition-colors hover:bg-slate-100"
        >
          /debug로 이동
        </Link>
      </section>
    </main>
  );
}

export function DocumentEmptyState(): React.ReactElement {
  return (
    <section className="rounded-lg border border-slate-300 bg-white p-6" aria-label="문서 없음 상태">
      <h2 className="text-xl font-semibold text-slate-900">문서를 불러와 주세요.</h2>
      <p className="mt-2 text-sm text-slate-600">PDF 파일 열기 또는 새 백지 만들기로 시작하세요.</p>
      <p className="mt-1 text-sm text-slate-600">
        이 단계에서는 파일이 브라우저 내부에서만 처리되며 서버로 업로드되지 않습니다.
      </p>
    </section>
  );
}

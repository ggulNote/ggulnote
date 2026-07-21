import { useId } from "react";

type ToolbarProps = {
  onOpenPdf: (file: File | null) => void;
  onCreateBlank: () => void;
  onClose: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onSetPage: (value: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitWidth: () => void;
  status: "empty" | "loading" | "ready" | "error";
  currentPage: number;
  totalPages: number;
  zoom: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  disabledPageInput: boolean;
  canFitWidth: boolean;
};

function FileInput({ onOpenPdf }: { onOpenPdf: (file: File | null) => void }): React.ReactElement {
  const id = useId();

  return (
    <>
      <label
        htmlFor={id}
        className="inline-flex rounded border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 cursor-pointer"
      >
        PDF 파일 열기
      </label>
      <input
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="PDF 파일 선택"
        onChange={(event) => {
          onOpenPdf(event.currentTarget.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

export function DocumentToolbar({
  onOpenPdf,
  onCreateBlank,
  onClose,
  onPreviousPage,
  onNextPage,
  onSetPage,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitWidth,
  status,
  currentPage,
  totalPages,
  zoom,
  canGoPrevious,
  canGoNext,
  disabledPageInput,
  canFitWidth,
}: ToolbarProps): React.ReactElement {
  const pageInputId = useId();

  const submitPage = (value: string) => {
    const next = Number(value);
    if (!Number.isInteger(next)) {
      return;
    }

    onSetPage(next);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="문서 도구 모음">
      <h2 className="text-xl font-semibold text-slate-900">꿀노트 문서 보기</h2>

      <p className="mt-2 text-sm text-slate-600">
        PDF 파일을 열면 뷰어로 표시되며, 향후 Canvas Editor Core에서 주석 편집이 이어집니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FileInput onOpenPdf={onOpenPdf} />
        <button
          type="button"
          onClick={onCreateBlank}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          새 백지 만들기
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={status === "empty" || status === "loading"}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          aria-label="문서 닫기"
        >
          문서 닫기
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="페이지 이동">
        <button
          type="button"
          onClick={onPreviousPage}
          disabled={!canGoPrevious || status === "loading"}
          aria-label="이전 페이지"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          이전
        </button>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const pageInput = event.currentTarget.elements.namedItem("page");
            if (!(pageInput instanceof HTMLInputElement)) {
              return;
            }

            submitPage(pageInput.value);
          }}
        >
          <label htmlFor={pageInputId} className="text-sm font-semibold">
            페이지
          </label>
          <input
            id={pageInputId}
            type="text"
            inputMode="numeric"
            name="page"
            defaultValue={currentPage}
            disabled={disabledPageInput}
            className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
            aria-label="현재 페이지"
            onBlur={(event) => submitPage(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitPage((event.currentTarget as HTMLInputElement).value);
              }
            }}
          />
        </form>
        <span className="text-sm text-slate-700">/ {totalPages}</span>
        <button
          type="button"
          onClick={onNextPage}
          disabled={!canGoNext || status === "loading"}
          aria-label="다음 페이지"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          다음
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="확대/축소">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= 50 || status === "loading"}
          aria-label="축소"
          className="rounded border px-3 py-2 text-sm"
        >
          -
        </button>
        <span className="text-sm font-semibold" aria-live="polite">
          {zoom}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= 200 || status === "loading"}
          aria-label="확대"
          className="rounded border px-3 py-2 text-sm"
        >
          +
        </button>
        <button
          type="button"
          onClick={onResetZoom}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          100%
        </button>
        <button
          type="button"
          onClick={onFitWidth}
          disabled={!canFitWidth}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          aria-label="화면 너비 맞춤"
        >
          화면 너비 맞춤
        </button>
      </div>
    </section>
  );
}

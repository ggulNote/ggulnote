import { type ReactNode } from "react";
import { type DocumentKind } from "../model/document-types";
import { type DocumentSessionState } from "../model/document-state";
import { BlankPage } from "./blank-page";
import { DocumentEmptyState } from "./document-empty-state";
import { DocumentErrorState } from "./document-error-state";
import { PdfPageCanvas } from "./pdf-page-canvas";

type DocumentStageProps = {
  state: DocumentSessionState;
  mode: "empty" | "loading" | "ready" | "error";
  statusMessage?: string | null;
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  stageRef: (element: HTMLDivElement | null) => void;
  pointer: { x: number; y: number } | null;
  children?: ReactNode;
};

const statusMap: Record<DocumentKind, string> = {
  none: "No Document",
  pdf: "PDF",
  blank: "Blank",
};

export function DocumentStage({
  state,
  mode,
  statusMessage,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  stageRef,
  pointer,
  children,
}: DocumentStageProps): React.ReactElement {
  const documentKind: DocumentKind = state.document?.kind ?? "none";
  const pageWidth = state.renderedWidth > 0 ? state.renderedWidth : state.page?.width ?? 0;
  const pageHeight = state.renderedHeight > 0 ? state.renderedHeight : state.page?.height ?? 0;

  const width = Math.max(pageWidth, 220);
  const height = Math.max(pageHeight, 220);

  const content = (() => {
    if (mode === "error") {
      return <DocumentErrorState message={statusMessage ?? "문서 처리 중 오류가 발생했습니다."} />;
    }

    if (mode === "empty") {
      return <DocumentEmptyState />;
    }

    if (documentKind === "blank") {
      return <BlankPage width={width} height={height} />;
    }

    return <PdfPageCanvas canvasRef={canvasRef} />;
  })();

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-100 p-4" aria-label="문서 표시 영역">
      {mode === "loading" ? (
        <p aria-live="polite" className="mb-2 rounded bg-white px-3 py-2 text-sm text-slate-700">
          {statusMessage ?? "문서를 처리하고 있습니다."}
        </p>
      ) : null}

      <div className="relative overflow-auto">
        <div
          className="relative mx-auto min-w-[220px] min-h-[220px] bg-white"
          ref={stageRef}
          style={{ width, height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="relative h-full w-full">
              <div className="absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-1 text-xs text-white">
                {statusMap[documentKind]} {state.page ? `${state.currentPage} / ${state.totalPages}` : ""}
              </div>
            </div>
          </div>

          <div className="relative h-full w-full">{content}</div>

          <div className="absolute inset-0">{children}</div>

          <div className="pointer-events-none absolute inset-0">
            {pointer ? (
              <div
                className="absolute h-2 w-2 rounded-full bg-blue-500"
                style={{
                  left: `${pointer.x * width}px`,
                  top: `${pointer.y * height}px`,
                  transform: "translate(-50%, -50%)",
                }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

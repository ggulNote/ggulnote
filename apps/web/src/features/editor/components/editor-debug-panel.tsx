import { useMemo } from "react";
import type { EditorSnapshot, SerializedAnnotation } from "@ggulnote/editor-core";

type Props = {
  editorSnapshot: EditorSnapshot;
  interactionMode: string;
  pageSize: { width: number; height: number };
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  pointer: { x: number; y: number } | null;
  selectedAnnotation: SerializedAnnotation | null;
  undoStackSize: number;
  redoStackSize: number;
};

export function EditorDebugPanel({
  editorSnapshot,
  interactionMode,
  pageSize,
  canvasWidth,
  canvasHeight,
  dpr,
  pointer,
  selectedAnnotation,
  undoStackSize,
  redoStackSize,
}: Props): React.ReactElement {
  const selectedId = editorSnapshot.selectedAnnotationId ?? "-";
  const selectedType = selectedAnnotation ? selectedAnnotation.type : "-";
  const hasSelection = Boolean(editorSnapshot.selectedAnnotationId);

  const jsonText = useMemo(() => {
    if (!selectedAnnotation) {
      return "";
    }

    return JSON.stringify(selectedAnnotation, null, 2);
  }, [selectedAnnotation]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="Editor Debug Panel">
      <h2 className="text-sm font-semibold text-slate-700">Editor status</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt>Document ID</dt>
          <dd>{editorSnapshot.documentId ?? "-"}</dd>
        </div>
        <div>
          <dt>Active page ID</dt>
          <dd>{editorSnapshot.activePageId ?? "-"}</dd>
        </div>
        <div>
          <dt>Interaction mode</dt>
          <dd>{interactionMode}</dd>
        </div>
        <div>
          <dt>Annotation count</dt>
          <dd>{editorSnapshot.annotationCount}</dd>
        </div>
        <div>
          <dt>Selected annotation ID</dt>
          <dd>{selectedId}</dd>
        </div>
        <div>
          <dt>Selected annotation type</dt>
          <dd>{selectedType}</dd>
        </div>
        <div>
          <dt>Can undo</dt>
          <dd>{editorSnapshot.canUndo ? "true" : "false"}</dd>
        </div>
        <div>
          <dt>Can redo</dt>
          <dd>{editorSnapshot.canRedo ? "true" : "false"}</dd>
        </div>
        <div>
          <dt>Undo stack size</dt>
          <dd>{undoStackSize}</dd>
        </div>
        <div>
          <dt>Redo stack size</dt>
          <dd>{redoStackSize}</dd>
        </div>
        <div>
          <dt>Last operation</dt>
          <dd>{editorSnapshot.lastOperation ? editorSnapshot.lastOperation.type : "-"}</dd>
        </div>
        <div>
          <dt>Pointer NORM X</dt>
          <dd>{pointer ? pointer.x.toFixed(4) : "-"}</dd>
        </div>
        <div>
          <dt>Pointer NORM Y</dt>
          <dd>{pointer ? pointer.y.toFixed(4) : "-"}</dd>
        </div>
        <div>
          <dt>Canvas CSS</dt>
          <dd>{Math.round(canvasWidth)} x {Math.round(canvasHeight)}</dd>
        </div>
        <div>
          <dt>Canvas px</dt>
          <dd>{Math.round(canvasWidth * dpr)} x {Math.round(canvasHeight * dpr)}</dd>
        </div>
        <div>
          <dt>Page size</dt>
          <dd>{Math.round(pageSize.width)} x {Math.round(pageSize.height)}</dd>
        </div>
        <div>
          <dt>DPR</dt>
          <dd>{dpr.toFixed(2)}</dd>
        </div>
      </dl>

      <details className="mt-4">
        <summary className="text-sm font-semibold">Selected annotation JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap rounded bg-slate-900/5 p-2">
          {hasSelection ? jsonText : "No selected annotation"}
        </pre>
      </details>
    </section>
  );
}

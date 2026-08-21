"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Size } from "@ggulnote/editor-core";
import { Tldraw, type Editor } from "tldraw";
import {
  HandwritingTextShapeUtil,
  MathObjectShapeUtil,
  NoteAnnotationShapeUtil,
  TldrawEditorAdapter,
} from "../../editor/adapters/tldraw";
import {
  LocalEditorPersistence,
  TLDRAW_CANVAS_STORE_VERSION,
} from "../local-persistence";

const SHAPE_UTILS = [
  NoteAnnotationShapeUtil,
  MathObjectShapeUtil,
  HandwritingTextShapeUtil,
] as const;
const SAVE_DEBOUNCE_MS = 250;

export interface TldrawCanvasLayerProps {
  readonly documentId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly pageSize: Size;
  readonly renderedSize: Size;
  readonly persistence: LocalEditorPersistence;
  readonly hidden?: boolean;
  onAdapterReady(adapter: TldrawEditorAdapter | null): void;
  onSceneChange(revision: number): void;
}

/** PDF/blank overlay whose only mutable canvas source of truth is TLStore. */
export function TldrawCanvasLayer({
  documentId,
  pageId,
  pageNumber,
  pageSize,
  renderedSize,
  persistence,
  hidden = false,
  onAdapterReady,
  onSceneChange,
}: TldrawCanvasLayerProps): React.ReactElement {
  const editorRef = useRef<Editor | null>(null);
  const adapterRef = useRef<TldrawEditorAdapter | null>(null);
  const onAdapterReadyRef = useRef(onAdapterReady);
  const onSceneChangeRef = useRef(onSceneChange);

  useEffect(() => {
    onAdapterReadyRef.current = onAdapterReady;
    onSceneChangeRef.current = onSceneChange;
  }, [onAdapterReady, onSceneChange]);

  const cameraOptions = useMemo(() => ({
    isLocked: true,
    wheelBehavior: "none" as const,
  }), []);

  const syncCamera = useCallback((editor: Editor): void => {
    const zoom = pageSize.width > 0 && renderedSize.width > 0
      ? renderedSize.width / pageSize.width
      : 1;
    editor.setCamera(
      { x: 0, y: 0, z: Number.isFinite(zoom) && zoom > 0 ? zoom : 1 },
      { immediate: true, force: true },
    );
    editor.setCameraOptions(cameraOptions);
  }, [cameraOptions, pageSize.width, renderedSize.width]);

  useEffect(() => {
    const editor = editorRef.current;
    const adapter = adapterRef.current;
    if (editor === null || adapter === null) return;
    adapter.setPageSize(pageSize);
    syncCamera(editor);
  }, [pageSize, syncCamera]);

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    const adapter = new TldrawEditorAdapter(
      editor,
      documentId,
      pageId,
      pageNumber,
      pageSize,
    );
    adapterRef.current = adapter;
    let disposed = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let unlistenDocument: (() => void) | undefined;

    const persistNow = (): void => {
      const snapshot = adapter.snapshot();
      const projection = adapter.exportPageProjection();
      void persistence.saveTldrawPageSnapshot({
        documentId,
        pageId,
        pageNumber,
        snapshot,
        annotations: projection.annotations,
      });
    };
    const scheduleSave = (): void => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
      }, SAVE_DEBOUNCE_MS);
    };

    const initialize = async (): Promise<void> => {
      const record = await persistence.getPageSnapshot(documentId, pageId);
      if (disposed) return;
      if (
        record?.tldrawSnapshot !== undefined
        && record.tldrawCanvasStoreVersion === TLDRAW_CANVAS_STORE_VERSION
      ) {
        adapter.load(record.tldrawSnapshot);
      } else if (record !== null) {
        adapter.importLegacyPageSnapshot({
          documentId: record.documentId,
          pageId: record.pageId,
          pageNumber: record.pageNumber,
          revision: record.revision,
          annotations: record.annotations,
        });
      }
      syncCamera(editor);
      if (disposed) return;
      unlistenDocument = editor.store.listen(() => {
        adapter.markSceneChanged();
        onSceneChangeRef.current(adapter.getSceneRevision());
        scheduleSave();
      }, { scope: "document" });
      onAdapterReadyRef.current(adapter);
      onSceneChangeRef.current(adapter.getSceneRevision());
    };

    syncCamera(editor);
    void initialize();

    return () => {
      disposed = true;
      unlistenDocument?.();
      if (saveTimer !== null) clearTimeout(saveTimer);
      if (adapterRef.current === adapter) {
        persistNow();
        adapterRef.current = null;
        editorRef.current = null;
        onAdapterReadyRef.current(null);
      }
    };
  }, [documentId, pageId, pageNumber, pageSize, persistence, syncCamera]);

  return (
    <div
      className="ggulnote-tldraw-overlay absolute inset-0 z-20"
      hidden={hidden}
      data-testid="tldraw-canvas-layer"
    >
      <Tldraw
        autoFocus={false}
        hideUi
        initialState="select"
        shapeUtils={SHAPE_UTILS}
        cameraOptions={cameraOptions}
        onMount={handleMount}
      />
    </div>
  );
}

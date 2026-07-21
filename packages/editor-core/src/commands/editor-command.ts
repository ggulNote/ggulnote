import type { AnnotationId, PageId } from "@ggulnote/shared-types";
import type { PageScene } from "../scene/page-scene";
import type { SceneStore } from "../scene/scene-store";
import type { EditorOperation } from "../operations/editor-operation";

export interface EditorCommandContext {
  getSceneStore(): SceneStore;
  getActivePageId(): PageId | null;
  selectAnnotation(annotationId: AnnotationId | null): void;
  getSelectedAnnotationId(): AnnotationId | null;
  getPageScene(pageId: PageId): PageScene;
  notifyChange(): void;
}

export interface EditorCommand {
  execute(context: EditorCommandContext): void;
  undo(context: EditorCommandContext): void;
  toOperation(): EditorOperation;
}

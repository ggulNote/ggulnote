import type {
  AnnotationId,
  DocumentId,
  NormalizedPoint,
  PageId,
  Size,
} from "@ggulnote/shared-types";
import { AnnotationFactory } from "../annotations/annotation-factory";
import type { CreateAnnotationInput } from "../annotations/annotation-types";
import { DeleteAnnotationCommand } from "../commands/delete-annotation-command";
import { UpdateAnnotationCommand } from "../commands/update-annotation-command";
import { MoveAnnotationCommand } from "../commands/move-annotation-command";
import { CreateAnnotationCommand } from "../commands/create-annotation-command";
import type { EditorCommandContext } from "../commands/editor-command";
import { deserializeAnnotation, serializeAnnotation } from "../serialization/annotation-serializer";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import { CommandManager } from "../commands/command-manager";
import { SceneStore } from "../scene/scene-store";
import type { AnnotationRenderer } from "../rendering/annotation-renderer";
import { EditorOperation } from "../operations/editor-operation";
import type { EditorSnapshot, PageSceneSnapshot } from "./editor-snapshot";
import type { EditorOptions } from "./editor-options";
import { EditorHistoryAction, type EditorEvents, type EditorPersistenceEvent } from "./editor-events";
import { isFiniteNumber } from "./editor-utils";
export const DEFAULT_HISTORY_LIMIT = 100;

type DragMode = "move" | "resize";

type Listener = () => void;

type DragState = {
  annotationId: AnnotationId;
  pageId: PageId;
  startPointer: NormalizedPoint;
  startSnapshot: SerializedAnnotation;
  mode: DragMode;
};

const PAGE_ID_PATTERN = /-page-(\d+)$/u;

export class EditorEngine {
  private readonly sceneStore = new SceneStore();
  private readonly listeners = new Set<Listener>();
  private readonly operationListeners = new Set<(event: EditorPersistenceEvent) => void>();
  private readonly commandManager: CommandManager;
  private readonly annotationFactory: AnnotationFactory;

  private documentId: DocumentId | null = null;
  private activePageId: PageId | null = null;
  private activePageSize: Size | null = null;
  private selectedAnnotationId: AnnotationId | null = null;
  private lastOperation: EditorOperation | null = null;
  private revision = 0;
  private cachedSnapshot: EditorSnapshot | null = null;
  private dragState: DragState | null = null;
  private destroyed = false;
  private readonly pageRevisions = new Map<PageId, number>();

  public constructor(
    options: EditorOptions = {},
    private readonly events: EditorEvents = {},
  ) {
    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.annotationFactory = new AnnotationFactory({
      idGenerator: options.idGenerator,
    });

    this.commandManager = new CommandManager(() => this.getCommandContext(), {
      historyLimit,
    });
  }

  public setDocument(documentId: DocumentId | null): void {
    if (this.destroyed) {
      return;
    }

    if (this.documentId === documentId) {
      return;
    }

    this.documentId = documentId;
    this.sceneStore.clear();
    this.pageRevisions.clear();
    this.commandManager.clear();
    this.activePageId = null;
    this.activePageSize = null;
    this.selectedAnnotationId = null;
    this.lastOperation = null;
    this.dragState = null;
    this.emit();
  }

  public setActivePage(pageId: PageId | null, pageSize?: Size): void {
    if (this.destroyed) {
      return;
    }

    const previous = this.activePageId;
    this.activePageId = pageId;

    if (!pageId) {
      this.activePageSize = null;
    } else if (
      pageSize &&
      isFiniteNumber(pageSize.width) &&
      isFiniteNumber(pageSize.height) &&
      pageSize.width > 0 &&
      pageSize.height > 0
    ) {
      this.activePageSize = { ...pageSize };
    }

    if (previous !== pageId) {
      this.selectedAnnotationId = null;
      this.dragState = null;
    }

    this.emit();
  }

  public setActivePageSize(pageSize: Size | null): void {
    if (this.destroyed || !pageSize || !isFiniteNumber(pageSize.width) || !isFiniteNumber(pageSize.height)) {
      return;
    }

    if (pageSize.width <= 0 || pageSize.height <= 0) {
      return;
    }

    if (!this.activePageId) {
      return;
    }

    this.activePageSize = { ...pageSize };
    this.emit();
  }

  public getActivePageId(): PageId | null {
    return this.activePageId;
  }

  public getDocumentId(): DocumentId | null {
    return this.documentId;
  }

  public getActivePageSize(): Size | null {
    return this.activePageSize ? { ...this.activePageSize } : null;
  }

  public getSelectedAnnotationId(): AnnotationId | null {
    return this.selectedAnnotationId;
  }

  public canUndo(): boolean {
    return this.commandManager.canUndo();
  }

  public canRedo(): boolean {
    return this.commandManager.canRedo();
  }

  public getUndoStackSize(): number {
    return this.commandManager.getUndoStackSize();
  }

  public getRedoStackSize(): number {
    return this.commandManager.getRedoStackSize();
  }

  public getSnapshot(): EditorSnapshot {
    if (this.cachedSnapshot !== null && this.cachedSnapshot.revision === this.revision) {
      return this.cachedSnapshot;
    }

    this.cachedSnapshot = {
      documentId: this.documentId,
      activePageId: this.activePageId,
      selectedAnnotationId: this.selectedAnnotationId,
      annotationCount: this.sceneStore.totalAnnotationCount(),
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      lastOperation: this.lastOperation,
      revision: this.revision,
    };

    return this.cachedSnapshot;
  }

  public getSelectedAnnotationSnapshot(): SerializedAnnotation | null {
    const selected = this.getSelectedAnnotation();
    return selected ? serializeAnnotation(selected) : null;
  }

  public exportPageSnapshot(pageId: PageId): PageSceneSnapshot {
    if (!this.documentId) {
      throw new Error("Active document is required");
    }

    const scene = this.sceneStore.getPage(pageId);
    const annotations = scene ? scene.getAll().map((annotation) => annotation.serialize()) : [];

    return {
      documentId: this.documentId,
      pageId,
      pageNumber: this.parsePageNumber(pageId),
      revision: this.pageRevisions.get(pageId) ?? 0,
      annotations,
    };
  }

  public hydratePage(snapshot: PageSceneSnapshot): void {
    if (!this.documentId) {
      throw new Error("Active document is required");
    }

    if (snapshot.documentId !== this.documentId) {
      throw new Error("Cannot hydrate snapshot from different document");
    }

    const annotations = snapshot.annotations.map((raw) => deserializeAnnotation(raw));
    this.sceneStore.replacePage(snapshot.pageId, annotations);

    const currentRevision = this.pageRevisions.get(snapshot.pageId) ?? 0;
    if (snapshot.revision >= currentRevision) {
      this.pageRevisions.set(snapshot.pageId, snapshot.revision);
    }

    this.selectedAnnotationId = null;
    this.dragState = null;
    this.emit();
  }

  public createAnnotation(input: CreateAnnotationInput): AnnotationId {
    this.assertActiveSession();

    if (!input || !input.pageId) {
      throw new Error("Annotation input is invalid");
    }

    const pageId = this.activePageId ?? input.pageId;
    if (!pageId) {
      throw new Error("Active page is required");
    }

    const annotationInput: CreateAnnotationInput = {
      ...input,
      pageId,
    };

    const annotation = this.annotationFactory.create(annotationInput);
    this.sceneStore.getOrCreatePage(pageId);
    const command = new CreateAnnotationCommand(annotation, this.documentId as DocumentId);
    this.commandManager.execute(command);
    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "execute");

    return annotation.id;
  }

  public selectAt(point: NormalizedPoint): AnnotationId | null {
    this.assertActiveSession();

    if (!this.activePageId) {
      this.select(null);
      return null;
    }

    const scene = this.getActiveScene();
    if (!scene) {
      this.select(null);
      return null;
    }

    const hit = scene.hitTest(point, this.getWorkingPageSize());
    this.select(hit?.id ?? null);
    return hit?.id ?? null;
  }

  public select(annotationId: AnnotationId | null): void {
    if (this.selectedAnnotationId === annotationId) {
      return;
    }

    this.selectedAnnotationId = annotationId;
    this.emit();
  }

  public startDrag(pointer: NormalizedPoint, mode: DragMode = "move"): boolean {
    this.assertActiveSession();

    if (!this.activePageId) {
      return false;
    }

    if (!this.selectedAnnotationId || !isFiniteNumber(pointer.x) || !isFiniteNumber(pointer.y)) {
      return false;
    }

    const selected = this.getSelectedAnnotation();
    if (!selected) {
      return false;
    }

    if (mode === "resize" && !this.canResizeAnnotation(selected)) {
      return false;
    }

    this.dragState = {
      annotationId: selected.id,
      pageId: selected.pageId,
      startPointer: { ...pointer },
      startSnapshot: serializeAnnotation(selected),
      mode,
    };

    return true;
  }

  public isResizeHandle(point: NormalizedPoint): boolean {
    if (!this.documentId || !this.activePageId || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return false;
    }

    const selected = this.getSelectedAnnotation();
    if (!selected || !this.canResizeAnnotation(selected)) {
      return false;
    }

    const bounds = selected.bounds;
    if (bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    const tolerance = 0.02;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;

    return point.x >= right - tolerance && point.x <= right + tolerance && point.y >= bottom - tolerance && point.y <= bottom + tolerance;
  }

  public moveDrag(pointer: NormalizedPoint): void {
    if (!this.dragState) {
      return;
    }

    const pageId = this.dragState.pageId;
    if (this.activePageId !== pageId) {
      this.cancelDrag();
      return;
    }

    const scene = this.getPageScene(pageId);
    if (!scene.get(this.dragState.annotationId)) {
      return;
    }

    const rawX = isFiniteNumber(pointer.x) ? pointer.x : this.dragState.startPointer.x;
    const rawY = isFiniteNumber(pointer.y) ? pointer.y : this.dragState.startPointer.y;

    const delta = {
      x: rawX - this.dragState.startPointer.x,
      y: rawY - this.dragState.startPointer.y,
    };

    const dragged = deserializeAnnotation(this.dragState.startSnapshot);
    if (this.dragState.mode === "resize") {
      this.applyResize(dragged, rawX, rawY);
    } else {
      dragged.translate(delta);
    }

    dragged.clampToBounds(this.getWorkingPageSize());
    scene.update(dragged);
  }

  public commitDrag(): void {
    if (!this.dragState || !this.documentId || !this.activePageId) {
      return;
    }

    const pageId = this.dragState.pageId;
    const annotationId = this.dragState.annotationId;
    const scene = this.getPageScene(pageId);
    const current = scene.get(annotationId);

    if (current) {
      const finalSnapshot = current.serialize();
      const before = this.dragState.startSnapshot;
      const changed = JSON.stringify(before) !== JSON.stringify(finalSnapshot);

      if (changed) {
        const command =
          this.dragState.mode === "resize"
            ? new UpdateAnnotationCommand(before, finalSnapshot, this.documentId)
            : new MoveAnnotationCommand(before, finalSnapshot, this.documentId);
        this.commandManager.execute(command);
        this.lastOperation = command.toOperation();
        this.publishOperation(this.lastOperation, "execute");
      } else {
        const original = deserializeAnnotation(before);
        scene.update(original);
      }
    }

    this.dragState = null;
    this.emit();
  }

  public cancelDrag(): void {
    if (!this.dragState) {
      return;
    }

    const scene = this.getPageScene(this.dragState.pageId);
    const current = scene.get(this.dragState.annotationId);
    if (current) {
      const origin = deserializeAnnotation(this.dragState.startSnapshot);
      scene.update(origin);
    }

    this.dragState = null;
    this.emit();
  }

  public moveSelected(delta: NormalizedPoint): void {
    if (!this.documentId) {
      return;
    }

    if (!isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) {
      return;
    }

    const selected = this.getSelectedAnnotation();
    if (!selected) {
      return;
    }

    const snapshot = selected.serialize();
    const moved = deserializeAnnotation(snapshot);
    moved.translate(delta);
    moved.clampToBounds(this.getValidPageSize() ?? { width: 1, height: 1 });
    const next = moved.serialize();

    if (JSON.stringify(snapshot) === JSON.stringify(next)) {
      return;
    }

    const command = new MoveAnnotationCommand(snapshot, next, this.documentId);
    this.commandManager.execute(command);
    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "execute");
  }

  public deleteSelected(): void {
    const selected = this.getSelectedAnnotation();
    if (!selected || !this.documentId) {
      return;
    }

    const command = new DeleteAnnotationCommand(selected.serialize(), this.documentId);
    this.commandManager.execute(command);
    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "execute");
    this.selectedAnnotationId = null;
  }

  public updateSelected(updated: SerializedAnnotation): void {
    if (!this.documentId) {
      return;
    }

    const selected = this.getSelectedAnnotation();
    if (!selected || selected.id !== updated.id) {
      return;
    }

    const before = selected.serialize();
    if (JSON.stringify(before) === JSON.stringify(updated)) {
      return;
    }

    const command = new UpdateAnnotationCommand(before, updated, this.documentId);
    this.commandManager.execute(command);
    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "execute");
  }

  public undo(): void {
    if (!this.documentId) {
      return;
    }

    const command = this.commandManager.undo();
    if (!command) {
      return;
    }

    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "undo");
  }

  public redo(): void {
    if (!this.documentId) {
      return;
    }

    const command = this.commandManager.redo();
    if (!command) {
      return;
    }

    this.lastOperation = command.toOperation();
    this.publishOperation(this.lastOperation, "redo");
  }

  public render(renderer: AnnotationRenderer, devicePixelRatio = 1): void {
    if (this.destroyed) {
      return;
    }

    const pageSize = this.getValidPageSize() ?? { width: 1, height: 1 };
    const scene = this.getActiveScene();
    const context = {
      pageSize,
      dpr: isFiniteNumber(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
      selectedAnnotationId: this.selectedAnnotationId,
    };

    renderer.beginFrame(context);
    if (!scene) {
      renderer.endFrame();
      return;
    }

    const annotations = scene.getAll();
    for (const annotation of annotations) {
      renderer.render(annotation);
    }

    if (this.selectedAnnotationId) {
      const selected = this.getSelectedAnnotation();
      if (selected) {
        renderer.renderSelection(selected);
      }
    }

    renderer.endFrame();
  }

  public subscribe(listener: Listener): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeToOperations(listener: (event: EditorPersistenceEvent) => void): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    this.operationListeners.add(listener);
    return () => {
      this.operationListeners.delete(listener);
    };
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.listeners.clear();
    this.operationListeners.clear();
    this.commandManager.clear();
    this.sceneStore.clear();
    this.documentId = null;
    this.activePageId = null;
    this.activePageSize = null;
    this.selectedAnnotationId = null;
    this.lastOperation = null;
    this.dragState = null;
    this.pageRevisions.clear();
    this.emit();
  }

  private canResizeAnnotation(annotation: { type: string }): boolean {
    return annotation.type !== "LINE";
  }

  private applyResize(annotation: { bounds: { x: number; y: number; width: number; height: number } }, pointerX: number, pointerY: number): void {
    const normalizedX = isFiniteNumber(pointerX) ? pointerX : annotation.bounds.x;
    const normalizedY = isFiniteNumber(pointerY) ? pointerY : annotation.bounds.y;

    annotation.bounds = {
      ...annotation.bounds,
      width: Math.max(0, normalizedX - annotation.bounds.x),
      height: Math.max(0, normalizedY - annotation.bounds.y),
    };
  }

  private getCommandContext(): EditorCommandContext {
    return {
      getSceneStore: () => this.sceneStore,
      getActivePageId: () => this.activePageId,
      selectAnnotation: (annotationId) => {
        this.selectedAnnotationId = annotationId;
      },
      getSelectedAnnotationId: () => this.selectedAnnotationId,
      getPageScene: (pageId: PageId) => this.sceneStore.getOrCreatePage(pageId),
      notifyChange: () => {
        this.emit();
      },
    };
  }

  private getActiveScene() {
    if (!this.activePageId) {
      return null;
    }

    return this.sceneStore.getPage(this.activePageId);
  }

  private getPageScene(pageId: PageId) {
    return this.sceneStore.getOrCreatePage(pageId);
  }

  private getSelectedAnnotation() {
    if (!this.activePageId) {
      return null;
    }

    const scene = this.sceneStore.getPage(this.activePageId);
    if (!scene || !this.selectedAnnotationId) {
      return null;
    }

    return scene.get(this.selectedAnnotationId);
  }

  private getWorkingPageSize(): Size {
    return this.getValidPageSize() ?? { width: 1, height: 1 };
  }

  private getValidPageSize(): Size | null {
    if (!this.activePageSize || !isFiniteNumber(this.activePageSize.width) || !isFiniteNumber(this.activePageSize.height)) {
      return null;
    }

    if (this.activePageSize.width <= 0 || this.activePageSize.height <= 0) {
      return null;
    }

    return this.activePageSize;
  }

  private emit(): void {
    if (this.destroyed) {
      return;
    }

    this.revision += 1;
    this.cachedSnapshot = null;

    for (const listener of this.listeners) {
      listener();
    }
  }

  private publishOperation(operation: EditorOperation, historyAction: EditorHistoryAction): void {
    if (!this.documentId) {
      return;
    }

    const revision = this.bumpPageRevision(operation.pageId);
    const event: EditorPersistenceEvent = {
      documentId: this.documentId,
      pageId: operation.pageId,
      pageNumber: this.parsePageNumber(operation.pageId),
      historyAction,
      operation,
      revision,
    };

    for (const listener of this.operationListeners) {
      listener(event);
    }
  }

  private getPageRevision(pageId: PageId): number {
    return this.pageRevisions.get(pageId) ?? 0;
  }

  private bumpPageRevision(pageId: PageId): number {
    const next = this.getPageRevision(pageId) + 1;
    this.pageRevisions.set(pageId, next);
    return next;
  }

  private parsePageNumber(pageId: PageId): number {
    const match = PAGE_ID_PATTERN.exec(pageId);
    if (!match?.[1]) {
      return 1;
    }

    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  private assertActiveSession(): void {
    if (this.destroyed || !this.documentId) {
      throw new Error("Active document is required");
    }
  }
}


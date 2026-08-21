import type {
  EditorEngine,
  EditorPersistenceEvent,
} from "@ggulnote/editor-core";
import type {
  DirectRecentOperation,
} from "../domain";
import type { DirectRecentOperationsSource } from "../application";
import { editorAnnotationSceneId } from "./editor-voice-context";

const DEFAULT_RECENT_OPERATION_CAPACITY = 64;

export interface EditorDirectRecentOperationsSourceOptions {
  editorEngine: EditorEngine;
  capacity?: number;
}

export class EditorDirectRecentOperationsSource
implements DirectRecentOperationsSource {
  private readonly editorEngine: EditorEngine;
  private readonly capacity: number;
  private readonly unsubscribe: () => void;
  private operations: DirectRecentOperation[] = [];

  public constructor(options: EditorDirectRecentOperationsSourceOptions) {
    this.editorEngine = options.editorEngine;
    this.capacity = positiveInteger(
      options.capacity ?? DEFAULT_RECENT_OPERATION_CAPACITY,
      "capacity",
    );
    this.unsubscribe = this.editorEngine.subscribeToOperations((event) => {
      this.record(event);
    });
  }

  public getRecentOperations(pageId: string): readonly DirectRecentOperation[] {
    return this.operations
      .filter((operation) => operation.pageId === pageId)
      .map((operation) => ({ ...operation }));
  }

  public dispose(): void {
    this.unsubscribe();
    this.operations = [];
  }

  private record(event: EditorPersistenceEvent): void {
    const targetSceneObjectId = this.readTargetSceneObjectId(event);
    const operation: DirectRecentOperation = {
      operationId: event.operation.operationId,
      pageId: event.pageId,
      operationType: event.operation.type,
      annotationId: event.operation.annotationId,
      createdAt: event.operation.createdAt,
      historyAction: event.historyAction,
      ...(event.operation.sourceTurnId === undefined
        ? {}
        : { sourceTurnId: event.operation.sourceTurnId }),
      ...(event.operation.toolId === undefined
        ? {}
        : { toolId: event.operation.toolId }),
      ...(event.operation.undoGroupId === undefined
        ? {}
        : { undoGroupId: event.operation.undoGroupId }),
      ...(targetSceneObjectId === undefined
        ? {}
        : { targetSceneObjectId }),
    };
    this.operations.push(operation);
    if (this.operations.length > this.capacity) {
      this.operations.splice(0, this.operations.length - this.capacity);
    }
  }

  private readTargetSceneObjectId(
    event: EditorPersistenceEvent,
  ): string | undefined {
    try {
      const annotation = this.editorEngine.exportPageSnapshot(event.pageId)
        .annotations.find((candidate) =>
          candidate.id === event.operation.annotationId,
        );
      return annotation === undefined
        ? undefined
        : editorAnnotationSceneId(annotation);
    } catch {
      return undefined;
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

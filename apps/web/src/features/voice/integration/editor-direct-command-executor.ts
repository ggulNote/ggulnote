import type {
  EditorEngine,
  EditorPersistenceEvent,
  SerializedAnnotation,
} from "@ggulnote/editor-core";
import type {
  DirectCommandExecutionResult,
  DirectCommandRuntimeInstruction,
  ReadyForDirectCommandExecution,
} from "../domain";
import { compileDirectCommandCapability } from "../application/direct-command-capability-compiler";
import { editorAnnotationSceneId } from "./editor-voice-context";

export interface DirectCommandExecutor {
  execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult>;
}

export interface DirectCommandNavigationPort {
  getCurrentPage(): number;
  goToPage(page: number): void | Promise<void>;
}

export interface DocumentSessionDirectCommandNavigationOptions {
  getCurrentPage(): number;
  goToPage(page: number): void;
}

export function createDocumentSessionDirectCommandNavigationPort(
  options: DocumentSessionDirectCommandNavigationOptions,
): DirectCommandNavigationPort {
  return {
    getCurrentPage: () => options.getCurrentPage(),
    goToPage: (page) => options.goToPage(page),
  };
}

export interface EditorDirectCommandExecutorOptions {
  editorEngine: EditorEngine;
  navigation: DirectCommandNavigationPort;
  getCurrentSceneRevision(): number;
}

export class EditorDirectCommandExecutor implements DirectCommandExecutor {
  public constructor(
    private readonly options: EditorDirectCommandExecutorOptions,
  ) {}

  public async execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult> {
    const compiled = compileDirectCommandCapability(ready, {
      pageSize: this.options.editorEngine.getActivePageSize() ?? undefined,
    });
    if (compiled.status === "ERROR") {
      return this.error(ready, compiled.errorCode);
    }

    const instruction = compiled.instruction;
    if (
      isSceneMutation(instruction)
      && !this.canCommitFrozenScene(ready)
    ) {
      return this.error(ready, "STALE_SCENE");
    }

    try {
      switch (instruction.kind) {
        case "CREATE_ANNOTATION":
          return this.createAnnotation(ready, instruction);
        case "REPLACE_TEXT_CONTENT":
          return this.replaceTextContent(ready, instruction);
        case "NAVIGATE": {
          const result = await this.navigate(ready, instruction);
          return result;
        }
        case "UNDO":
          return this.undo(ready);
      }
    } catch {
      return this.error(ready, "COMMIT_FAILED");
    }
  }

  private createAnnotation(
    ready: ReadyForDirectCommandExecution,
    instruction: Extract<
      DirectCommandRuntimeInstruction,
      { kind: "CREATE_ANNOTATION" }
    >,
  ): DirectCommandExecutionResult {
    const captured = this.captureOperation(() =>
      this.options.editorEngine.createAnnotation(instruction.input));
    if (
      captured.event?.historyAction !== "execute"
      || captured.event.operation.type !== "CREATE_ANNOTATION"
      || captured.event.operation.annotationId !== captured.value
    ) {
      return this.error(ready, "COMMIT_FAILED");
    }
    return {
      status: "COMMITTED",
      turnId: ready.turnId,
      planId: ready.plan.planId,
      operationId: captured.event.operation.operationId,
    };
  }

  private replaceTextContent(
    ready: ReadyForDirectCommandExecution,
    instruction: Extract<
      DirectCommandRuntimeInstruction,
      { kind: "REPLACE_TEXT_CONTENT" }
    >,
  ): DirectCommandExecutionResult {
    const pageSnapshot = this.options.editorEngine.exportPageSnapshot(
      instruction.pageId,
    );
    const target = findEditorAnnotation(
      pageSnapshot.annotations,
      instruction.sceneObjectId,
    );
    if (target === undefined) {
      return this.error(ready, "INVALID_TARGET");
    }
    if (target.type !== "TEXT") {
      return this.error(ready, "TARGET_NOT_EDITABLE");
    }

    const updated: SerializedAnnotation = {
      ...target,
      properties: {
        ...target.properties,
        text: instruction.text,
      },
      updatedAt: Date.now(),
    };
    this.options.editorEngine.select(target.id);
    const captured = this.captureOperation(() =>
      this.options.editorEngine.updateSelected(updated));
    if (
      captured.event?.historyAction !== "execute"
      || captured.event.operation.type !== "UPDATE_ANNOTATION"
      || captured.event.operation.annotationId !== target.id
    ) {
      return this.error(ready, "COMMIT_FAILED");
    }
    return {
      status: "COMMITTED",
      turnId: ready.turnId,
      planId: ready.plan.planId,
      operationId: captured.event.operation.operationId,
    };
  }

  private async navigate(
    ready: ReadyForDirectCommandExecution,
    instruction: Extract<
      DirectCommandRuntimeInstruction,
      { kind: "NAVIGATE" }
    >,
  ): Promise<DirectCommandExecutionResult> {
    const currentPage = this.options.navigation.getCurrentPage();
    if (!Number.isInteger(currentPage) || currentPage < 1) {
      return this.error(ready, "COMMIT_FAILED");
    }
    const delta = instruction.direction === "next_page" ? 1 : -1;
    await this.options.navigation.goToPage(currentPage + delta);
    return {
      status: "NAVIGATED",
      turnId: ready.turnId,
      direction: instruction.direction,
    };
  }

  private undo(
    ready: ReadyForDirectCommandExecution,
  ): DirectCommandExecutionResult {
    if (!this.options.editorEngine.canUndo()) {
      return this.error(ready, "UNDO_NOT_AVAILABLE");
    }
    const captured = this.captureOperation(() =>
      this.options.editorEngine.undo());
    if (captured.event?.historyAction !== "undo") {
      return this.error(ready, "COMMIT_FAILED");
    }
    return {
      status: "UNDONE",
      turnId: ready.turnId,
      operationId: captured.event.operation.operationId,
    };
  }

  private canCommitFrozenScene(
    ready: ReadyForDirectCommandExecution,
  ): boolean {
    return this.options.getCurrentSceneRevision()
      === ready.context.frozenContext.sceneRevision
      && this.options.editorEngine.getActivePageId()
        === ready.context.frozenContext.pageId;
  }

  private captureOperation<T>(action: () => T): {
    value: T;
    event?: EditorPersistenceEvent;
  } {
    let event: EditorPersistenceEvent | undefined;
    const unsubscribe = this.options.editorEngine.subscribeToOperations(
      (nextEvent) => {
        event = nextEvent;
      },
    );
    try {
      return {
        value: action(),
        ...(event === undefined ? {} : { event }),
      };
    } finally {
      unsubscribe();
    }
  }

  private error(
    ready: ReadyForDirectCommandExecution,
    errorCode: Extract<
      DirectCommandExecutionResult,
      { status: "ERROR" }
    >["errorCode"],
  ): DirectCommandExecutionResult {
    return { status: "ERROR", turnId: ready.turnId, errorCode };
  }
}

function findEditorAnnotation(
  annotations: readonly SerializedAnnotation[],
  sceneObjectId: string,
): SerializedAnnotation | undefined {
  return annotations.find(
    (annotation) => editorAnnotationSceneId(annotation) === sceneObjectId,
  );
}

function isSceneMutation(
  instruction: DirectCommandRuntimeInstruction,
): boolean {
  return instruction.kind === "CREATE_ANNOTATION"
    || instruction.kind === "REPLACE_TEXT_CONTENT";
}

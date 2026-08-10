import type {
  EditorEngine,
  EditorPersistenceEvent,
  SerializedAnnotation,
} from "@ggulnote/editor-core";
import type { InteractionClock } from "@ggulnote/interaction-core";
import type {
  DirectCommandExecutionResult,
  DirectCommandExecutionTimestamps,
  DirectCommandRuntimeInstruction,
  DirectOperationRecord,
  ReadyForDirectCommandExecution,
} from "../domain";
import {
  compileDirectCommandCapability,
  compileDirectCommandRevision,
} from "../application/direct-command-capability-compiler";
import { editorAnnotationSceneId } from "./editor-voice-context";

export interface DirectCommandExecutor {
  execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult>;
  revise(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord,
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
  clock: Pick<InteractionClock, "now">;
}

export class EditorDirectCommandExecutor implements DirectCommandExecutor {
  public constructor(
    private readonly options: EditorDirectCommandExecutorOptions,
  ) {}

  public async execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult> {
    const timestamps: DirectCommandExecutionTimestamps = {
      compileStartedAt: this.now(),
    };
    const compiled = compileDirectCommandCapability(ready, {
      pageSize: this.options.editorEngine.getActivePageSize() ?? undefined,
    });
    timestamps.compiledAt = this.now();
    if (compiled.status === "ERROR") {
      return this.error(ready, compiled.errorCode, timestamps);
    }

    const instruction = compiled.instruction;
    if (
      isSceneMutation(instruction)
      && !this.canCommitFrozenScene(ready)
    ) {
      return this.error(ready, "STALE_SCENE", timestamps);
    }

    timestamps.commitStartedAt = this.now();
    try {
      let result: DirectCommandExecutionResult;
      switch (instruction.kind) {
        case "CREATE_ANNOTATION":
          result = this.createAnnotation(ready, instruction);
          break;
        case "REPLACE_TEXT_CONTENT":
          result = this.replaceTextContent(ready, instruction);
          break;
        case "UPDATE_HIGHLIGHT_COLOR":
          result = this.error(ready, "REVISE_NOT_AVAILABLE");
          break;
        case "NAVIGATE": {
          result = await this.navigate(ready, instruction);
          break;
        }
        case "UNDO":
          result = this.undo(ready);
          break;
      }
      if (result.status !== "ERROR") timestamps.committedAt = this.now();
      return withExecutionTimestamps(result, timestamps);
    } catch {
      return this.error(ready, "COMMIT_FAILED", timestamps);
    }
  }

  public async revise(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord,
  ): Promise<DirectCommandExecutionResult> {
    const timestamps: DirectCommandExecutionTimestamps = {
      compileStartedAt: this.now(),
    };
    const compiled = compileDirectCommandRevision(ready, previous);
    timestamps.compiledAt = this.now();
    if (compiled.status === "ERROR") {
      return this.error(ready, compiled.errorCode, timestamps);
    }
    const instruction = compiled.instruction;
    if (
      !isSceneMutation(instruction)
      || !this.canCommitFrozenScene(ready)
    ) {
      return this.error(ready, "STALE_SCENE", timestamps);
    }
    timestamps.commitStartedAt = this.now();
    try {
      let result: DirectCommandExecutionResult;
      switch (instruction.kind) {
        case "UPDATE_HIGHLIGHT_COLOR":
          result = this.updateHighlightColor(ready, instruction);
          break;
        case "REPLACE_TEXT_CONTENT":
          result = this.replaceTextContent(ready, instruction);
          break;
        case "CREATE_ANNOTATION":
        case "NAVIGATE":
        case "UNDO":
          result = this.error(ready, "REVISE_NOT_AVAILABLE");
          break;
      }
      if (result.status !== "ERROR") timestamps.committedAt = this.now();
      return withExecutionTimestamps(result, timestamps);
    } catch {
      return this.error(ready, "COMMIT_FAILED", timestamps);
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
      annotationId: captured.value,
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
      annotationId: target.id,
    };
  }

  private updateHighlightColor(
    ready: ReadyForDirectCommandExecution,
    instruction: Extract<
      DirectCommandRuntimeInstruction,
      { kind: "UPDATE_HIGHLIGHT_COLOR" }
    >,
  ): DirectCommandExecutionResult {
    const pageSnapshot = this.options.editorEngine.exportPageSnapshot(
      instruction.pageId,
    );
    const target = pageSnapshot.annotations.find(
      (annotation) => annotation.id === instruction.annotationId,
    );
    if (target === undefined || target.type !== "HIGHLIGHT") {
      return this.error(ready, "REVISE_NOT_AVAILABLE");
    }
    if (target.properties.color === instruction.color) {
      return this.error(ready, "REVISE_NOT_AVAILABLE");
    }
    const updated: SerializedAnnotation = {
      ...target,
      properties: {
        ...target.properties,
        color: instruction.color,
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
      annotationId: target.id,
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
    executionTimestamps?: DirectCommandExecutionTimestamps,
  ): DirectCommandExecutionResult {
    return {
      status: "ERROR",
      turnId: ready.turnId,
      errorCode,
      ...(executionTimestamps === undefined
        ? {}
        : { executionTimestamps }),
    };
  }

  private now(): number {
    return Number(this.options.clock.now());
  }
}

function withExecutionTimestamps(
  result: DirectCommandExecutionResult,
  executionTimestamps: DirectCommandExecutionTimestamps,
): DirectCommandExecutionResult {
  return { ...result, executionTimestamps: { ...executionTimestamps } };
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
    || instruction.kind === "REPLACE_TEXT_CONTENT"
    || instruction.kind === "UPDATE_HIGHLIGHT_COLOR";
}

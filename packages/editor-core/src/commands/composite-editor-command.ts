import type { EditorOperation } from "../operations/editor-operation";
import { createOperation } from "../operations/editor-operation";
import type { EditorCommand, EditorCommandContext } from "./editor-command";

/** One CommandManager entry for a fully prepared mutation batch. */
export class CompositeEditorCommand implements EditorCommand {
  private executed: readonly EditorCommand[] = [];
  private operation: EditorOperation | null = null;
  private childOperations: readonly EditorOperation[] = [];

  public constructor(private readonly commands: readonly EditorCommand[]) {
    if (commands.length === 0) throw new RangeError("Composite command requires at least one child.");
  }

  public execute(context: EditorCommandContext): void {
    const completed: EditorCommand[] = [];
    try {
      for (const command of this.commands) {
        command.execute(context);
        completed.push(command);
      }
      const operations = completed.map((command) => command.toOperation());
      assertOnePage(operations);
      this.executed = Object.freeze([...completed]);
      this.childOperations = Object.freeze([...operations]);
      this.operation = operations.length === 1
        ? operations[0] ?? null
        : compositeOperation(operations);
    } catch (error) {
      for (const command of completed.reverse()) command.undo(context);
      this.executed = [];
      this.childOperations = [];
      this.operation = null;
      throw error;
    }
  }

  public undo(context: EditorCommandContext): void {
    for (const command of [...this.executed].reverse()) command.undo(context);
  }

  public toOperation(): EditorOperation {
    if (this.operation === null) throw new Error("Command not executed");
    return this.operation;
  }

  public toChildOperations(): readonly EditorOperation[] {
    return Object.freeze([...this.childOperations]);
  }
}

function assertOnePage(operations: readonly EditorOperation[]): void {
  const first = operations[0];
  if (first === undefined) throw new Error("Composite command has no operation.");
  if (operations.some((operation) =>
    operation.documentId !== first.documentId || operation.pageId !== first.pageId)) {
    throw new Error("Composite command operations must share one document and page.");
  }
}

function compositeOperation(operations: readonly EditorOperation[]): EditorOperation {
  const first = operations[0];
  const last = operations.at(-1);
  if (first === undefined || last === undefined) throw new Error("Composite operation is empty.");
  const undoGroupId = `batch:${first.operationId}`;
  return createOperation({
    documentId: first.documentId,
    pageId: first.pageId,
    annotationId: last.annotationId,
    type: "BATCH",
    payload: { operations: operations.map((operation) => ({ ...operation, undoGroupId })) },
    ...(first.sourceTurnId === undefined ? {} : { sourceTurnId: first.sourceTurnId }),
    toolId: "note.batch",
    undoGroupId,
  });
}

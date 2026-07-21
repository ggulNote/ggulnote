import type { EditorCommand, EditorCommandContext } from "./editor-command";

type CommandContextFactory = () => EditorCommandContext;

export interface CommandManagerOptions {
  historyLimit: number;
}

export class CommandManager {
  private undoStack: EditorCommand[] = [];
  private redoStack: EditorCommand[] = [];

  public constructor(
    private readonly getContext: CommandContextFactory,
    private readonly options: CommandManagerOptions,
  ) {
    if (!Number.isInteger(options.historyLimit) || options.historyLimit <= 0) {
      throw new Error("Invalid history limit");
    }
  }

  public execute(command: EditorCommand): void {
    const context = this.getContext();

    try {
      command.execute(context);
    } catch (error) {
      throw error;
    }

    this.undoStack.push(command);
    this.trimStack(this.undoStack);
    this.redoStack = [];
    context.notifyChange();
  }

  public undo(): EditorCommand | null {
    const command = this.popUndo();
    if (!command) {
      return null;
    }

    const context = this.getContext();
    try {
      command.undo(context);
    } catch (error) {
      this.undoStack.push(command);
      throw error;
    }

    this.pushRedo(command);
    context.notifyChange();
    return command;
  }

  public redo(): EditorCommand | null {
    const command = this.popRedo();
    if (!command) {
      return null;
    }

    const context = this.getContext();
    try {
      command.execute(context);
    } catch (error) {
      this.redoStack.push(command);
      throw error;
    }

    this.pushUndo(command);
    context.notifyChange();
    return command;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  public getUndoStackSize(): number {
    return this.undoStack.length;
  }

  public getRedoStackSize(): number {
    return this.redoStack.length;
  }

  private popUndo(): EditorCommand | null {
    return this.undoStack.pop() ?? null;
  }

  private popRedo(): EditorCommand | null {
    return this.redoStack.pop() ?? null;
  }

  private pushUndo(command: EditorCommand): void {
    this.undoStack.push(command);
    this.trimStack(this.undoStack);
  }

  private pushRedo(command: EditorCommand): void {
    this.redoStack.push(command);
    this.trimStack(this.redoStack);
  }

  private trimStack(stack: EditorCommand[]): void {
    if (stack.length > this.options.historyLimit) {
      stack.splice(0, stack.length - this.options.historyLimit);
    }
  }
}

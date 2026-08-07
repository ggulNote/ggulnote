import type {
  DirectCommandPlannerInput,
  DirectPlannerResult,
} from "../../domain";
import {
  parseDirectEditorCommand,
  parseDirectPlannerResult,
} from "../../domain";
import type {
  DirectCommandPlannerOptions,
  DirectCommandPlannerProvider,
} from "../direct-command-planner-provider";

export interface FakeDirectCommandPlannerProviderOptions {
  result: DirectPlannerResult;
  error?: unknown;
}

export interface FakeDirectCommandPlannerCall {
  input: DirectCommandPlannerInput;
  signal?: AbortSignal;
}

export class FakeDirectCommandPlannerProvider implements DirectCommandPlannerProvider {
  private result: DirectPlannerResult;
  private injectedError: unknown;
  private hasInjectedError = false;
  private readonly recordedCalls: FakeDirectCommandPlannerCall[] = [];

  public constructor(options: FakeDirectCommandPlannerProviderOptions) {
    this.result = parseDirectPlannerResult(options.result);
    if (options.error !== undefined) {
      this.injectedError = options.error;
      this.hasInjectedError = true;
    }
  }

  public async plan(
    input: DirectCommandPlannerInput,
    options: DirectCommandPlannerOptions = {},
  ): Promise<DirectPlannerResult> {
    const call: FakeDirectCommandPlannerCall = {
      input: clonePlannerInput(input),
    };
    if (options.signal !== undefined) {
      call.signal = options.signal;
    }
    this.recordedCalls.push(call);

    throwIfAborted(options.signal);
    await Promise.resolve();
    throwIfAborted(options.signal);

    if (this.hasInjectedError) {
      throw this.injectedError;
    }
    return parseDirectPlannerResult(this.result);
  }

  public get planCallCount(): number {
    return this.recordedCalls.length;
  }

  public get lastInput(): DirectCommandPlannerInput | undefined {
    const input = this.recordedCalls.at(-1)?.input;
    return input === undefined ? undefined : clonePlannerInput(input);
  }

  public get calls(): readonly FakeDirectCommandPlannerCall[] {
    return this.recordedCalls.map((call) => {
      const cloned: FakeDirectCommandPlannerCall = {
        input: clonePlannerInput(call.input),
      };
      if (call.signal !== undefined) {
        cloned.signal = call.signal;
      }
      return cloned;
    });
  }

  public setResult(result: DirectPlannerResult): void {
    this.result = parseDirectPlannerResult(result);
  }

  public injectError(error: unknown): void {
    this.injectedError = error;
    this.hasInjectedError = true;
  }

  public clearError(): void {
    this.injectedError = undefined;
    this.hasInjectedError = false;
  }
}

function clonePlannerInput(input: DirectCommandPlannerInput): DirectCommandPlannerInput {
  const focus = input.frozenContext.focus;
  const cloned: DirectCommandPlannerInput = {
    turn: { ...input.turn },
    frozenContext: {
      ...input.frozenContext,
      focus: focus === null
        ? null
        : {
            ...focus,
            ...(focus.bounds === undefined ? {} : { bounds: { ...focus.bounds } }),
          },
    },
    allowedCommands: [...input.allowedCommands],
  };

  if (input.lastOperation !== undefined) {
    cloned.lastOperation = {
      operationId: input.lastOperation.operationId,
      command: parseDirectEditorCommand(input.lastOperation.command),
    };
  }
  return cloned;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("Direct command planner request was aborted.");
  error.name = "AbortError";
  throw error;
}

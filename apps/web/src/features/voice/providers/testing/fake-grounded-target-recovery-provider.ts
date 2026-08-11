import {
  DirectAiProviderError,
  parseGroundedTargetRecoveryInput,
  parseGroundedTargetRecoveryResult,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryResult,
} from "../../domain";
import type {
  GroundedTargetRecoveryProvider,
  GroundedTargetRecoveryProviderOptions,
} from "../grounded-target-recovery-provider";

export interface FakeGroundedTargetRecoveryCall {
  input: GroundedTargetRecoveryInput;
  signal?: AbortSignal;
}

export class FakeGroundedTargetRecoveryProvider
implements GroundedTargetRecoveryProvider {
  private readonly recordedCalls: FakeGroundedTargetRecoveryCall[] = [];

  public constructor(
    private result: GroundedTargetRecoveryResult = { status: "NONE" },
    private error?: unknown,
  ) {}

  public async recover(
    input: GroundedTargetRecoveryInput,
    options: GroundedTargetRecoveryProviderOptions = {},
  ): Promise<GroundedTargetRecoveryResult> {
    const safeInput = parseGroundedTargetRecoveryInput(input);
    this.recordedCalls.push({
      input: safeInput,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (options.signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED");
    }
    await Promise.resolve();
    if (this.error !== undefined) throw this.error;
    return parseGroundedTargetRecoveryResult(this.result, safeInput);
  }

  public get recoverCallCount(): number {
    return this.recordedCalls.length;
  }

  public get lastInput(): GroundedTargetRecoveryInput | undefined {
    return this.recordedCalls.at(-1)?.input;
  }

  public setResult(result: GroundedTargetRecoveryResult): void {
    this.result = result;
  }

  public injectError(error: unknown): void {
    this.error = error;
  }
}

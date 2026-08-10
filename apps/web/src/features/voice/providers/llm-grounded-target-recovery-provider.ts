import {
  DirectAiProviderError,
  GroundedTargetRecoveryValidationError,
  isAbortError,
  parseGroundedTargetRecoveryResult,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryResult,
} from "../domain";
import { parseDirectModelJsonObject } from "./direct-model-json";
import { buildGroundedTargetRecoveryModelRequest } from "./grounded-target-recovery-prompt";
import type {
  GroundedTargetRecoveryProvider,
  GroundedTargetRecoveryProviderOptions,
} from "./grounded-target-recovery-provider";
import type { DirectTextModelTransport } from "./direct-text-model-transport";

export class LlmGroundedTargetRecoveryProvider
implements GroundedTargetRecoveryProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async recover(
    input: GroundedTargetRecoveryInput,
    options: GroundedTargetRecoveryProviderOptions = {},
  ): Promise<GroundedTargetRecoveryResult> {
    throwIfAborted(options.signal);
    let rawOutput: string;
    try {
      rawOutput = await this.transport.generate(
        buildGroundedTargetRecoveryModelRequest(input),
        options,
      );
      throwIfAborted(options.signal);
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError(
        "PLANNER_UNAVAILABLE",
        "NETWORK_FAILURE",
        { cause: error },
      );
    }

    try {
      return parseGroundedTargetRecoveryResult(
        parseDirectModelJsonObject(rawOutput),
        input,
      );
    } catch (error) {
      if (error instanceof DirectAiProviderError) {
        if (error.code === "PLANNER_INVALID_OUTPUT") {
          logInvalidRecoveryOutput(error.cause instanceof Error ? error.cause : error);
        }
        throw error;
      }
      if (error instanceof GroundedTargetRecoveryValidationError || error instanceof Error) {
        logInvalidRecoveryOutput(error);
        throw new DirectAiProviderError(
          "PLANNER_INVALID_OUTPUT",
          "INVALID_OUTPUT",
          { cause: error },
        );
      }
      throw error;
    }
  }
}

function logInvalidRecoveryOutput(error: Error): void {
  const schemaError = error instanceof GroundedTargetRecoveryValidationError;
  console.error("[direct-command-ai] Recovery output validation failure", {
    kind: schemaError ? "SCHEMA_VALIDATION" : "JSON_OR_LABEL_VALIDATION",
    ...(schemaError
      ? { path: sanitizeDiagnostic(error.path, 200) }
      : {}),
    message: sanitizeDiagnostic(error.message, 500),
  });
}

function sanitizeDiagnostic(value: string, maxChars: number): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, maxChars);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}

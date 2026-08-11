import type {
  GroundedTargetRecoveryInput,
  GroundedTargetRecoveryResult,
} from "../domain";

export interface GroundedTargetRecoveryProviderOptions {
  signal?: AbortSignal;
}

export interface GroundedTargetRecoveryProvider {
  recover(
    input: GroundedTargetRecoveryInput,
    options?: GroundedTargetRecoveryProviderOptions,
  ): Promise<GroundedTargetRecoveryResult>;
}

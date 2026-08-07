import type {
  DirectCommandPlannerInput,
  DirectPlannerResult,
} from "../domain";

export interface DirectCommandPlannerOptions {
  signal?: AbortSignal;
}

export interface DirectCommandPlannerProvider {
  plan(
    input: DirectCommandPlannerInput,
    options?: DirectCommandPlannerOptions,
  ): Promise<DirectPlannerResult>;
}

import {
  DirectAiProviderError,
  MultimodalPlacementValidationError,
  parseMultimodalPlacementChoice,
  type MeasuredDraft,
  type PlacementProfile,
  type PlacementCandidateAlias,
  type ResolvedSpatialAnchor,
  type ResolvedTarget,
  type SpatialPlacementQuery,
  type SpatialPlacementResult,
  type SpatialSceneSnapshot,
} from "../domain";
import type { MultimodalPlacementJudgeProvider } from "../providers/multimodal-placement-judge-provider";
import type {
  MultimodalPlacementObservationBuilder,
  MultimodalPlacementObservationDiagnostics,
} from "./multimodal-placement-observation";

export interface CurrentSpatialSceneReference {
  readonly pageId: string;
  readonly sceneRevision: number;
}

export interface CurrentSpatialSceneReferenceSource {
  getCurrentReference(): CurrentSpatialSceneReference | undefined;
}

export interface BoundedMultimodalPlacementResolverOptions {
  readonly observationBuilder: MultimodalPlacementObservationBuilder;
  readonly provider?: MultimodalPlacementJudgeProvider;
  readonly currentSceneSource: CurrentSpatialSceneReferenceSource;
  readonly now?: () => number;
}

export interface BoundedMultimodalPlacementInput {
  readonly phaseBResult: SpatialPlacementResult;
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly draft: MeasuredDraft;
  readonly profile: PlacementProfile;
  readonly instruction: string;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly subjectTarget?: ResolvedTarget;
  readonly signal?: AbortSignal;
}

export type MultimodalPlacementProviderDiagnostic =
  | "NOT_REQUIRED"
  | PlacementCandidateAlias
  | "NONE"
  | "ERROR"
  | "UNAVAILABLE"
  | "INVALID"
  | "CANCELLED"
  | "STALE";

export interface BoundedMultimodalPlacementDiagnostics {
  readonly multimodalRequired: boolean;
  readonly observation?: MultimodalPlacementObservationDiagnostics;
  readonly providerCallCount: 0 | 1;
  readonly providerLatencyMs: number;
  readonly providerResult: MultimodalPlacementProviderDiagnostic;
  readonly finalResult: SpatialPlacementResult["status"];
}

export interface BoundedMultimodalPlacementResolution {
  readonly result: SpatialPlacementResult;
  readonly diagnostics: BoundedMultimodalPlacementDiagnostics;
}

export class BoundedMultimodalPlacementResolver {
  private readonly now: () => number;

  public constructor(private readonly options: BoundedMultimodalPlacementResolverOptions) {
    this.now = options.now ?? Date.now;
  }

  public async resolve(
    input: BoundedMultimodalPlacementInput,
  ): Promise<BoundedMultimodalPlacementResolution> {
    if (input.phaseBResult.status !== "AMBIGUOUS") {
      return resolution(input.phaseBResult, false, 0, 0, "NOT_REQUIRED");
    }
    if (input.signal?.aborted) {
      return resolution(cancelled(), true, 0, 0, "CANCELLED");
    }
    if (this.options.provider === undefined) {
      return resolution(providerUnavailable(), true, 0, 0, "UNAVAILABLE");
    }

    const observationResult = await this.options.observationBuilder.build({
      snapshot: input.snapshot,
      query: input.query,
      draft: input.draft,
      profile: input.profile,
      candidates: input.phaseBResult.candidates,
      instruction: input.instruction,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (observationResult.status !== "READY") {
      const result = observationResult.status === "STALE_SCENE"
        ? staleScene()
        : observationResult.status === "CANCELLED"
          ? cancelled()
          : providerUnavailable();
      return resolution(
        result,
        true,
        0,
        0,
        observationResult.status === "STALE_SCENE"
          ? "STALE"
          : observationResult.status === "CANCELLED"
            ? "CANCELLED"
            : "UNAVAILABLE",
      );
    }
    const observation = observationResult.observation;
    const providerStartedAt = this.now();
    let rawChoice: unknown;
    try {
      rawChoice = await this.options.provider.judge(
        observation.request,
        input.signal === undefined ? {} : { signal: input.signal },
      );
    } catch (error) {
      const providerLatencyMs = elapsed(providerStartedAt, this.now());
      const normalized = providerErrorResult(error, input.signal);
      return {
        result: normalized.result,
        diagnostics: {
          multimodalRequired: true,
          observation: observation.diagnostics,
          providerCallCount: 1,
          providerLatencyMs,
          providerResult: normalized.diagnostic,
          finalResult: normalized.result.status,
        },
      };
    }
    const providerLatencyMs = elapsed(providerStartedAt, this.now());

    if (input.signal?.aborted) {
      return withObservation(cancelled(), observation.diagnostics, providerLatencyMs, "CANCELLED");
    }
    if (!isCurrent(this.options.currentSceneSource, observation.pageId, observation.sceneRevision)) {
      return withObservation(staleScene(), observation.diagnostics, providerLatencyMs, "STALE");
    }

    let choice;
    try {
      choice = parseMultimodalPlacementChoice(
        rawChoice,
        observation.request.candidates.map((candidate) => candidate.alias),
      );
    } catch (error) {
      if (!(error instanceof MultimodalPlacementValidationError || error instanceof Error)) {
        throw error;
      }
      return withObservation(
        invalidProviderChoice(),
        observation.diagnostics,
        providerLatencyMs,
        "INVALID",
      );
    }

    if (choice.choice === "NONE") {
      return withObservation(
        noFeasiblePlacement("The multimodal judge selected NONE."),
        observation.diagnostics,
        providerLatencyMs,
        "NONE",
      );
    }
    const selected = observation.aliasMap.get(choice.choice);
    if (selected === undefined
      || selected.snapshotId !== input.snapshot.snapshotId
      || selected.sceneRevision !== input.snapshot.sceneRevision) {
      return withObservation(
        invalidProviderChoice(),
        observation.diagnostics,
        providerLatencyMs,
        "INVALID",
      );
    }

    const result: SpatialPlacementResult = {
      status: "RESOLVED",
      source: "MULTIMODAL",
      placement: {
        snapshotId: input.snapshot.snapshotId,
        pageId: input.snapshot.pageId,
        sceneRevision: input.snapshot.sceneRevision,
        bounds: Object.freeze({ ...selected.bounds }),
        relation: input.query.relation,
        alignment: selected.alignment,
        candidate: selected,
        ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
        ...(input.subjectTarget === undefined
          ? {}
          : { subjectTarget: input.subjectTarget }),
      },
    };
    return withObservation(
      result,
      observation.diagnostics,
      providerLatencyMs,
      choice.choice,
    );
  }
}

function resolution(
  result: SpatialPlacementResult,
  multimodalRequired: boolean,
  providerCallCount: 0 | 1,
  providerLatencyMs: number,
  providerResult: MultimodalPlacementProviderDiagnostic,
): BoundedMultimodalPlacementResolution {
  return {
    result,
    diagnostics: {
      multimodalRequired,
      providerCallCount,
      providerLatencyMs,
      providerResult,
      finalResult: result.status,
    },
  };
}

function withObservation(
  result: SpatialPlacementResult,
  observation: MultimodalPlacementObservationDiagnostics,
  providerLatencyMs: number,
  providerResult: MultimodalPlacementProviderDiagnostic,
): BoundedMultimodalPlacementResolution {
  return {
    result,
    diagnostics: {
      multimodalRequired: true,
      observation,
      providerCallCount: 1,
      providerLatencyMs,
      providerResult,
      finalResult: result.status,
    },
  };
}

function providerErrorResult(
  error: unknown,
  signal: AbortSignal | undefined,
): {
  result: SpatialPlacementResult;
  diagnostic: MultimodalPlacementProviderDiagnostic;
} {
  if (signal?.aborted
    || error instanceof DirectAiProviderError && error.code === "ABORTED") {
    return { result: cancelled(), diagnostic: "CANCELLED" };
  }
  if (error instanceof DirectAiProviderError
    && error.code === "PLANNER_UNAVAILABLE"
    && error.reason === "MISSING_CONFIGURATION") {
    return { result: providerUnavailable(), diagnostic: "UNAVAILABLE" };
  }
  if (error instanceof DirectAiProviderError
    && error.code === "PLANNER_INVALID_OUTPUT") {
    return { result: invalidProviderChoice(), diagnostic: "INVALID" };
  }
  return { result: providerError(), diagnostic: "ERROR" };
}

function isCurrent(
  source: CurrentSpatialSceneReferenceSource,
  pageId: string,
  sceneRevision: number,
): boolean {
  const current = source.getCurrentReference();
  return current?.pageId === pageId && current.sceneRevision === sceneRevision;
}

function staleScene(): SpatialPlacementResult {
  return { status: "STALE_SCENE", error: { reason: "STALE_SCENE" } };
}

function cancelled(): SpatialPlacementResult {
  return { status: "CANCELLED", error: { reason: "CANCELLED" } };
}

function providerUnavailable(): SpatialPlacementResult {
  return {
    status: "PROVIDER_UNAVAILABLE",
    error: { reason: "PROVIDER_UNAVAILABLE" },
  };
}

function providerError(): SpatialPlacementResult {
  return { status: "PROVIDER_ERROR", error: { reason: "PROVIDER_ERROR" } };
}

function invalidProviderChoice(): SpatialPlacementResult {
  return {
    status: "INVALID_PROVIDER_CHOICE",
    error: { reason: "INVALID_PROVIDER_CHOICE" },
  };
}

function noFeasiblePlacement(message: string): SpatialPlacementResult {
  return {
    status: "NO_FEASIBLE_PLACEMENT",
    error: { reason: "NO_FEASIBLE_PLACEMENT", message },
  };
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}

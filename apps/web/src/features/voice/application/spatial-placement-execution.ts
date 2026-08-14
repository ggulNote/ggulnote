import type {
  DirectCommandExecutionResult,
  DirectCommandRouteErrorCode,
  ReadyForDirectCommandExecution,
  SpatialCommandExecutionDiagnostics,
  SpatialPlacementReason,
  SpatialSceneSnapshot,
  ValidatedSpatialPlacement,
} from "../domain";
import type { BoundedMultimodalPlacementResolver } from "./bounded-multimodal-placement-resolver";
import {
  generatePlacementCandidates,
  resolveDeterministically,
} from "./placement-candidate-engine";
import type {
  DraftMeasurementProvider,
  PlacementProfileProvider,
} from "./placement-profile-provider";
import type { PreviewValidationOrchestrator } from "./preview-validation-orchestrator";
import {
  resolveSpatialAnchor,
} from "./spatial-anchor-resolver";
import type {
  FrozenSpatialSceneReference,
  SpatialSceneSource,
} from "./spatial-scene-source";
import { selectedSpatialPlacementFromResult } from "./preview-validation-orchestrator";
import {
  applyPlacementChoicePolicy,
  resolveDelegatedLayoutFallback,
} from "./placement-choice-policy";

export interface ValidatedSpatialPlacementExecutionPort {
  executeSpatial(
    ready: ReadyForDirectCommandExecution,
    placement: ValidatedSpatialPlacement,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DirectCommandExecutionResult>;
}

export interface SpatialPlacementExecutionPipelineOptions {
  readonly sceneSource: SpatialSceneSource;
  readonly createSceneReference: (
    ready: ReadyForDirectCommandExecution,
  ) => FrozenSpatialSceneReference | undefined;
  readonly profiles: PlacementProfileProvider;
  readonly measurements: DraftMeasurementProvider;
  readonly multimodal: BoundedMultimodalPlacementResolver;
  readonly preview: PreviewValidationOrchestrator;
  readonly executor: ValidatedSpatialPlacementExecutionPort;
  readonly now?: () => number;
}

export interface SpatialPlacementExecutionResolution {
  readonly result: DirectCommandExecutionResult;
  readonly diagnostics: SpatialCommandExecutionDiagnostics;
}

export interface SpatialPlacementPreparationInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: import("../domain").SpatialPlacementQuery;
  readonly draft: import("../domain").MeasuredDraft;
  readonly profile: import("../domain").PlacementProfile;
  readonly instruction: string;
  readonly anchor?: import("../domain").ResolvedSpatialAnchor;
  readonly choicePolicy?: import("../domain").TextPlacementChoicePolicy;
  readonly signal?: AbortSignal;
}

export interface PreparedSpatialPlacement {
  readonly placement: ValidatedSpatialPlacement;
  readonly diagnostics: SpatialCommandExecutionDiagnostics;
}

export type SpatialPlacementPreparationResolution =
  | { readonly status: "READY"; readonly prepared: PreparedSpatialPlacement }
  | {
      readonly status: "ERROR";
      readonly errorCode: DirectCommandRouteErrorCode;
      readonly diagnostics: SpatialCommandExecutionDiagnostics;
    };

interface MutableDiagnostics {
  anchorResolution: SpatialCommandExecutionDiagnostics["anchorResolution"];
  rawCandidateCount: number;
  filteredCandidateCount: number;
  shortlistCandidateCount: number;
  deterministicGate: SpatialCommandExecutionDiagnostics["deterministicGate"];
  multimodalUsed: boolean;
  multimodalCallCount: 0 | 1;
  multimodalProviderResult: SpatialCommandExecutionDiagnostics["multimodalProviderResult"];
  screenshotCallCount: 0 | 1;
  selectionSource?: SpatialCommandExecutionDiagnostics["selectionSource"];
  previewAttemptCount: 0 | 1 | 2;
  validationResult: SpatialCommandExecutionDiagnostics["validationResult"];
  previewFailureReason?: SpatialCommandExecutionDiagnostics["previewFailureReason"];
  commitGuard: SpatialCommandExecutionDiagnostics["commitGuard"];
  runtimeExecuted: boolean;
  operationRecorded: boolean;
  placementChoicePolicy?: SpatialCommandExecutionDiagnostics["placementChoicePolicy"];
  stableFallbackUsed: boolean;
  failureReason?: SpatialCommandExecutionDiagnostics["failureReason"];
  anchorResolutionMs: number;
  candidateGenerationMs: number;
  multimodalMs: number;
  previewValidationMs: number;
  commitMs: number;
}

/**
 * Thin Phase E coordinator. Geometry, multimodal choice, preview validation,
 * and editor mutation remain owned by their existing phase/runtime boundaries.
 */
export class SpatialPlacementExecutionPipeline {
  private readonly now: () => number;

  public constructor(private readonly options: SpatialPlacementExecutionPipelineOptions) {
    this.now = options.now ?? Date.now;
  }

  public async execute(
    ready: ReadyForDirectCommandExecution,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SpatialPlacementExecutionResolution> {
    const startedAt = this.now();
    const diagnostics = initialDiagnostics();
    const query = ready.plan.placementQuery;
    if (query === undefined) {
      return this.failure(ready, diagnostics, startedAt, "SPATIAL_REQUIRED");
    }
    if (
      ready.plan.command.capability === "navigation"
      || ready.plan.command.capability === "history"
    ) {
      return this.failure(ready, diagnostics, startedAt, "UNSUPPORTED_CAPABILITY");
    }
    if (options.signal?.aborted) {
      return this.failure(ready, diagnostics, startedAt, "ABORTED");
    }

    const reference = this.options.createSceneReference(ready);
    if (reference === undefined) {
      return this.failure(ready, diagnostics, startedAt, "INVALID_SPATIAL_SCENE");
    }
    const sceneResult = this.options.sceneSource.getSnapshot(reference);
    if (sceneResult.status !== "READY") {
      return this.failure(
        ready,
        diagnostics,
        startedAt,
        sceneResult.status === "STALE_SCENE" ? "STALE_SCENE" : "INVALID_SPATIAL_SCENE",
      );
    }
    const snapshot = sceneResult.snapshot;

    const anchorStartedAt = this.now();
    const anchorResolution = resolveSpatialAnchor({
      snapshot,
      query,
      ...(ready.spatialAnchorTarget === undefined
        ? {}
        : { resolvedTarget: ready.spatialAnchorTarget }),
    });
    diagnostics.anchorResolutionMs = elapsed(anchorStartedAt, this.now());
    diagnostics.anchorResolution = anchorResolution.status;
    if (anchorResolution.status !== "RESOLVED") {
      return this.failure(
        ready,
        diagnostics,
        startedAt,
        anchorResolution.status === "STALE_SCENE" ? "STALE_SCENE" : "TARGET_NOT_FOUND",
      );
    }
    const anchor = anchorResolution.anchor;

    const profileResult = this.options.profiles.getProfile({
      capability: ready.plan.command.capability,
      operation: ready.plan.command.operation,
      command: ready.plan.command,
    });
    if (profileResult.status !== "SUPPORTED") {
      return this.failure(ready, diagnostics, startedAt, "UNSUPPORTED_CAPABILITY");
    }
    const profile = profileResult.profile;
    const measured = await this.options.measurements.measure({
      kind: "NEW_DRAFT",
      draftKey: `spatial-draft:${ready.turnId}`,
      capability: ready.plan.command.capability,
      command: ready.plan.command,
      profile,
    }, options);
    if (measured.status !== "MEASURED") {
      return this.failure(ready, diagnostics, startedAt, "UNSUPPORTED_CAPABILITY");
    }
    if (options.signal?.aborted) {
      return this.failure(ready, diagnostics, startedAt, "ABORTED");
    }

    const prepared = await this.prepareCore({
      snapshot,
      query,
      profile,
      draft: measured.draft,
      instruction: ready.spatialDecisionInstruction ?? ready.context.turn.rawTranscript,
      anchor,
      choicePolicy: ready.textPlacement?.choicePolicy,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }, diagnostics);
    if (prepared.status === "ERROR") {
      return this.failure(ready, diagnostics, startedAt, prepared.errorCode);
    }
    return this.commitPreparedCore(
      ready,
      prepared.placement,
      diagnostics,
      snapshot,
      startedAt,
      options,
    );
  }

  /** Runs candidate choice and Ghost Preview without persistent mutation. */
  public async preparePlacement(
    input: SpatialPlacementPreparationInput,
  ): Promise<SpatialPlacementPreparationResolution> {
    const startedAt = this.now();
    const diagnostics = initialDiagnostics();
    diagnostics.anchorResolution = input.query.reference.kind === "PAGE"
      || input.anchor !== undefined ? "RESOLVED" : "ANCHOR_NOT_FOUND";
    if (diagnostics.anchorResolution !== "RESOLVED") {
      diagnostics.failureReason = "TARGET_NOT_FOUND";
      return {
        status: "ERROR",
        errorCode: "TARGET_NOT_FOUND",
        diagnostics: finishDiagnostics(diagnostics, input.snapshot, startedAt, this.now()),
      };
    }
    const prepared = await this.prepareCore(input, diagnostics);
    if (prepared.status === "ERROR") {
      diagnostics.failureReason = prepared.errorCode;
      return {
        status: "ERROR",
        errorCode: prepared.errorCode,
        diagnostics: finishDiagnostics(diagnostics, input.snapshot, startedAt, this.now()),
      };
    }
    return {
      status: "READY",
      prepared: {
        placement: prepared.placement,
        diagnostics: finishDiagnostics(diagnostics, input.snapshot, startedAt, this.now()),
      },
    };
  }

  /** Commits a previously preview-validated placement through the existing final guard. */
  public executePrepared(
    ready: ReadyForDirectCommandExecution,
    prepared: PreparedSpatialPlacement,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SpatialPlacementExecutionResolution> {
    const now = this.now();
    const startedAt = Math.max(0, now - prepared.diagnostics.totalSpatialMs);
    const diagnostics = mutableDiagnostics(prepared.diagnostics);
    const frozen = ready.context.frozenContext;
    if (
      ready.plan.placementQuery === undefined
      || prepared.placement.pageId !== frozen.pageId
      || prepared.placement.sceneRevision !== frozen.sceneRevision
    ) {
      return Promise.resolve(this.failure(ready, diagnostics, startedAt, "STALE_SCENE"));
    }
    return this.commitPreparedCore(
      ready,
      prepared.placement,
      diagnostics,
      {
        pageId: prepared.placement.pageId,
        sceneRevision: prepared.placement.sceneRevision,
      },
      startedAt,
      options,
    );
  }

  private async prepareCore(
    input: SpatialPlacementPreparationInput,
    diagnostics: MutableDiagnostics,
  ): Promise<
    | { readonly status: "READY"; readonly placement: ValidatedSpatialPlacement }
    | { readonly status: "ERROR"; readonly errorCode: DirectCommandRouteErrorCode }
  > {
    if (input.signal?.aborted) return { status: "ERROR", errorCode: "ABORTED" };
    const candidateStartedAt = this.now();
    const generated = generatePlacementCandidates({
      snapshot: input.snapshot,
      query: input.query,
      profile: input.profile,
      draft: input.draft,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    });
    diagnostics.candidateGenerationMs = elapsed(candidateStartedAt, this.now());
    diagnostics.rawCandidateCount = generated.diagnostics.rawCandidateCount;
    diagnostics.filteredCandidateCount = generated.diagnostics.filteredCandidateCount;
    diagnostics.shortlistCandidateCount = generated.candidates.length;
    const gate = resolveDeterministically({
      snapshot: input.snapshot,
      query: input.query,
      candidates: generated.candidates,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    });
    diagnostics.deterministicGate = gateStatus(gate.status);
    if (gate.status === "NO_FEASIBLE_PLACEMENT" || gate.status === "STALE_SCENE") {
      return { status: "ERROR", errorCode: gate.status };
    }

    const choicePolicy = input.choicePolicy ?? "SEMANTIC_CONSTRAINT_REQUIRED";
    diagnostics.placementChoicePolicy = choicePolicy;
    const policyResolution = applyPlacementChoicePolicy({
      result: gate,
      policy: choicePolicy,
      snapshot: input.snapshot,
      query: input.query,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    });
    const multimodalStartedAt = this.now();
    const placement = await this.options.multimodal.resolve({
      phaseBResult: policyResolution.result,
      snapshot: input.snapshot,
      query: input.query,
      draft: input.draft,
      profile: input.profile,
      instruction: input.instruction,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    diagnostics.multimodalMs = elapsed(multimodalStartedAt, this.now());
    diagnostics.multimodalUsed = placement.diagnostics.multimodalRequired;
    diagnostics.multimodalCallCount = placement.diagnostics.providerCallCount;
    diagnostics.multimodalProviderResult = placement.diagnostics.providerResult;
    diagnostics.screenshotCallCount = placement.diagnostics.observation === undefined ? 0 : 1;
    let placementResult = placement.result;
    if (
      choicePolicy === "USER_DELEGATED_LAYOUT"
      && placementResult.status === "PROVIDER_UNAVAILABLE"
      && gate.status === "AMBIGUOUS"
    ) {
      placementResult = resolveDelegatedLayoutFallback({
        result: gate,
        snapshot: input.snapshot,
        query: input.query,
        ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      });
      diagnostics.stableFallbackUsed = placementResult.status === "RESOLVED";
    }
    if (placementResult.status === "AMBIGUOUS") {
      return { status: "ERROR", errorCode: "MULTIMODAL_UNRESOLVED" };
    }
    if (placementResult.status !== "RESOLVED") {
      return { status: "ERROR", errorCode: placementFailure(placementResult.status) };
    }
    const selected = selectedSpatialPlacementFromResult(placementResult);
    if (selected === undefined) {
      return { status: "ERROR", errorCode: "MULTIMODAL_UNRESOLVED" };
    }
    diagnostics.selectionSource = selected.source;
    const previewStartedAt = this.now();
    const validated = await this.options.preview.validate({
      selected,
      candidates: generated.candidates,
      snapshot: input.snapshot,
      query: input.query,
      profile: input.profile,
      draft: input.draft,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    diagnostics.previewValidationMs = elapsed(previewStartedAt, this.now());
    diagnostics.previewAttemptCount = validated.diagnostics.previewAttemptCount;
    diagnostics.validationResult = validated.status;
    if (validated.status !== "VALIDATED") {
      diagnostics.previewFailureReason = validated.reason;
      return { status: "ERROR", errorCode: previewFailure(validated.status) };
    }
    diagnostics.selectionSource = validated.placement.selectionSource;
    return { status: "READY", placement: validated.placement };
  }

  private async commitPreparedCore(
    ready: ReadyForDirectCommandExecution,
    placement: ValidatedSpatialPlacement,
    diagnostics: MutableDiagnostics,
    scene: Pick<SpatialSceneSnapshot, "pageId" | "sceneRevision">,
    startedAt: number,
    options: { readonly signal?: AbortSignal },
  ): Promise<SpatialPlacementExecutionResolution> {
    if (options.signal?.aborted) {
      return this.failure(ready, diagnostics, startedAt, "ABORTED");
    }
    const commitStartedAt = this.now();
    const result = await this.options.executor.executeSpatial(ready, placement, options);
    diagnostics.commitMs = elapsed(commitStartedAt, this.now());
    diagnostics.runtimeExecuted = result.status === "COMMITTED";
    diagnostics.operationRecorded = result.status === "COMMITTED";
    diagnostics.commitGuard = result.status === "COMMITTED"
      ? "PASSED"
      : result.status === "ERROR" && result.errorCode === "STALE_SCENE"
        ? "REJECTED"
        : "NOT_RUN";
    if (result.status === "ERROR") diagnostics.failureReason = result.errorCode;
    return {
      result,
      diagnostics: finishDiagnostics(diagnostics, scene, startedAt, this.now()),
    };
  }

  private failure(
    ready: ReadyForDirectCommandExecution,
    diagnostics: MutableDiagnostics,
    startedAt: number,
    reason: DirectCommandRouteErrorCode,
  ): SpatialPlacementExecutionResolution {
    diagnostics.failureReason = reason;
    return {
      result: { status: "ERROR", turnId: ready.turnId, errorCode: reason },
      diagnostics: finishDiagnostics(
        diagnostics,
        {
          pageId: ready.context.frozenContext.pageId,
          sceneRevision: ready.context.frozenContext.sceneRevision,
        },
        startedAt,
        this.now(),
      ),
    };
  }
}

function initialDiagnostics(): MutableDiagnostics {
  return {
    anchorResolution: "ANCHOR_NOT_FOUND",
    rawCandidateCount: 0,
    filteredCandidateCount: 0,
    shortlistCandidateCount: 0,
    deterministicGate: "NO_FEASIBLE_PLACEMENT",
    multimodalUsed: false,
    multimodalCallCount: 0,
    multimodalProviderResult: "NOT_REQUIRED",
    screenshotCallCount: 0,
    previewAttemptCount: 0,
    validationResult: "NOT_RUN",
    commitGuard: "NOT_RUN",
    runtimeExecuted: false,
    operationRecorded: false,
    stableFallbackUsed: false,
    anchorResolutionMs: 0,
    candidateGenerationMs: 0,
    multimodalMs: 0,
    previewValidationMs: 0,
    commitMs: 0,
  };
}

function mutableDiagnostics(
  source: SpatialCommandExecutionDiagnostics,
): MutableDiagnostics {
  return {
    anchorResolution: source.anchorResolution,
    rawCandidateCount: source.rawCandidateCount,
    filteredCandidateCount: source.filteredCandidateCount,
    shortlistCandidateCount: source.shortlistCandidateCount,
    deterministicGate: source.deterministicGate,
    multimodalUsed: source.multimodalUsed,
    multimodalCallCount: source.multimodalCallCount,
    multimodalProviderResult: source.multimodalProviderResult,
    screenshotCallCount: source.screenshotCallCount,
    ...(source.selectionSource === undefined ? {} : { selectionSource: source.selectionSource }),
    previewAttemptCount: source.previewAttemptCount,
    validationResult: source.validationResult,
    ...(source.previewFailureReason === undefined
      ? {}
      : { previewFailureReason: source.previewFailureReason }),
    commitGuard: source.commitGuard,
    runtimeExecuted: source.runtimeExecuted,
    operationRecorded: source.operationRecorded,
    ...(source.placementChoicePolicy === undefined
      ? {}
      : { placementChoicePolicy: source.placementChoicePolicy }),
    stableFallbackUsed: source.stableFallbackUsed,
    ...(source.failureReason === undefined ? {} : { failureReason: source.failureReason }),
    anchorResolutionMs: source.anchorResolutionMs,
    candidateGenerationMs: source.candidateGenerationMs,
    multimodalMs: source.multimodalMs,
    previewValidationMs: source.previewValidationMs,
    commitMs: source.commitMs,
  };
}

function finishDiagnostics(
  diagnostics: MutableDiagnostics,
  scene: Pick<SpatialSceneSnapshot, "pageId" | "sceneRevision">,
  startedAt: number,
  completedAt: number,
): SpatialCommandExecutionDiagnostics {
  return Object.freeze({
    placementRequested: true,
    pageId: scene.pageId,
    sceneRevision: scene.sceneRevision,
    ...diagnostics,
    totalSpatialMs: elapsed(startedAt, completedAt),
  });
}

function gateStatus(
  status: "RESOLVED" | "AMBIGUOUS" | SpatialPlacementReason,
): SpatialCommandExecutionDiagnostics["deterministicGate"] {
  return status === "RESOLVED" || status === "AMBIGUOUS"
    || status === "NO_FEASIBLE_PLACEMENT" || status === "STALE_SCENE"
    ? status
    : "NO_FEASIBLE_PLACEMENT";
}

function placementFailure(status: SpatialPlacementReason): DirectCommandRouteErrorCode {
  switch (status) {
    case "NO_FEASIBLE_PLACEMENT":
      return "NO_FEASIBLE_PLACEMENT";
    case "STALE_SCENE":
      return "STALE_SCENE";
    case "CANCELLED":
      return "ABORTED";
    case "ANCHOR_NOT_FOUND":
      return "TARGET_NOT_FOUND";
    case "UNSUPPORTED":
      return "UNSUPPORTED_CAPABILITY";
    case "PREVIEW_INVALID":
      return "VALIDATION_FAILED";
    case "INVALID_SCENE_GEOMETRY":
      return "INVALID_SPATIAL_SCENE";
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_ERROR":
    case "INVALID_PROVIDER_CHOICE":
      return "MULTIMODAL_UNRESOLVED";
  }
}

function previewFailure(
  status: Exclude<SpatialCommandExecutionDiagnostics["validationResult"], "NOT_RUN" | "VALIDATED">,
): DirectCommandRouteErrorCode {
  switch (status) {
    case "PREVIEW_UNAVAILABLE":
      return "PREVIEW_UNAVAILABLE";
    case "PREVIEW_RENDER_FAILED":
      return "PREVIEW_RENDER_FAILED";
    case "STALE_SCENE":
      return "STALE_SCENE";
    case "ABORTED":
      return "ABORTED";
    case "VALIDATION_FAILED":
      return "VALIDATION_FAILED";
  }
}

function elapsed(startedAt: number, completedAt: number): number {
  return Math.max(0, completedAt - startedAt);
}

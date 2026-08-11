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

    const candidateStartedAt = this.now();
    const generated = generatePlacementCandidates({
      snapshot,
      query,
      profile,
      draft: measured.draft,
      anchor,
    });
    diagnostics.candidateGenerationMs = elapsed(candidateStartedAt, this.now());
    diagnostics.rawCandidateCount = generated.diagnostics.rawCandidateCount;
    diagnostics.filteredCandidateCount = generated.diagnostics.filteredCandidateCount;
    diagnostics.shortlistCandidateCount = generated.candidates.length;
    const gate = resolveDeterministically({
      snapshot,
      query,
      candidates: generated.candidates,
      anchor,
    });
    diagnostics.deterministicGate = gateStatus(gate.status);
    if (gate.status === "NO_FEASIBLE_PLACEMENT") {
      return this.failure(ready, diagnostics, startedAt, "NO_FEASIBLE_PLACEMENT");
    }
    if (gate.status === "STALE_SCENE") {
      return this.failure(ready, diagnostics, startedAt, "STALE_SCENE");
    }

    const choicePolicy = ready.textPlacement?.choicePolicy
      ?? "SEMANTIC_CONSTRAINT_REQUIRED";
    diagnostics.placementChoicePolicy = choicePolicy;
    const policyResolution = applyPlacementChoicePolicy({
      result: gate,
      policy: choicePolicy,
      snapshot,
      query,
      anchor,
    });

    const multimodalStartedAt = this.now();
    const placement = await this.options.multimodal.resolve({
      phaseBResult: policyResolution.result,
      snapshot,
      query,
      draft: measured.draft,
      profile,
      instruction: ready.context.turn.rawTranscript,
      anchor,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
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
        snapshot,
        query,
        anchor,
      });
      diagnostics.stableFallbackUsed = placementResult.status === "RESOLVED";
    }
    if (placementResult.status === "AMBIGUOUS") {
      return this.failure(ready, diagnostics, startedAt, "MULTIMODAL_UNRESOLVED");
    }
    if (placementResult.status !== "RESOLVED") {
      return this.failure(
        ready,
        diagnostics,
        startedAt,
        placementFailure(placementResult.status),
      );
    }
    const selected = selectedSpatialPlacementFromResult(placementResult);
    if (selected === undefined) {
      return this.failure(ready, diagnostics, startedAt, "MULTIMODAL_UNRESOLVED");
    }
    diagnostics.selectionSource = selected.source;

    const previewStartedAt = this.now();
    const validated = await this.options.preview.validate({
      selected,
      candidates: generated.candidates,
      snapshot,
      query,
      profile,
      draft: measured.draft,
      anchor,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    diagnostics.previewValidationMs = elapsed(previewStartedAt, this.now());
    diagnostics.previewAttemptCount = validated.diagnostics.previewAttemptCount;
    diagnostics.validationResult = validated.status;
    if (validated.status !== "VALIDATED") {
      return this.failure(
        ready,
        diagnostics,
        startedAt,
        previewFailure(validated.status),
      );
    }
    diagnostics.selectionSource = validated.placement.selectionSource;
    if (options.signal?.aborted) {
      return this.failure(ready, diagnostics, startedAt, "ABORTED");
    }

    const commitStartedAt = this.now();
    const result = await this.options.executor.executeSpatial(
      ready,
      validated.placement,
      options,
    );
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
      diagnostics: finishDiagnostics(diagnostics, snapshot, startedAt, this.now()),
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

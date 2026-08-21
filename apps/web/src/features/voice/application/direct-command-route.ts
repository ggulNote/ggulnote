import type { InteractionClock } from "@ggulnote/interaction-core";
import type {
  CompletedVoiceTurn,
  DirectCommandExecutionResult,
  DirectCommandLifecycleTimestamps,
  DirectCommandPlanningResult,
  DirectCommandRouteResult,
  DirectCommandTrace,
  DirectCommandTraceDiagnostics,
  DirectOperationRecord,
  DirectReusableTargetRecord,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
  SpatialCommandExecutionDiagnostics,
  TargetQuery,
} from "../domain";
import { calculateDirectCommandLatencyMetrics } from "./direct-command-diagnostics";
import { DirectCommandExecutionRegistry } from "./direct-command-execution-registry";
import { DirectCommandHistoryContext } from "./direct-command-history-context";
import type { DirectCommandPlanningOptions } from "./direct-command-planning-pipeline";
import type {
  PreparedSpatialPlacement,
  SpatialPlacementExecutionResolution,
  SpatialPlacementPreparationInput,
  SpatialPlacementPreparationResolution,
} from "./spatial-placement-execution";

export interface DirectCommandPlanningPort {
  plan(
    turn: CompletedVoiceTurn,
    options?: DirectCommandPlanningOptions,
  ): Promise<DirectCommandPlanningResult>;
}

export interface DirectCommandExecutionPort {
  execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult>;
  revise(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord,
  ): Promise<DirectCommandExecutionResult>;
}

export interface SpatialCommandExecutionPort {
  execute(
    ready: ReadyForDirectCommandExecution,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SpatialPlacementExecutionResolution>;
  preparePlacement?(
    input: SpatialPlacementPreparationInput,
  ): Promise<SpatialPlacementPreparationResolution>;
  executePrepared?(
    ready: ReadyForDirectCommandExecution,
    prepared: PreparedSpatialPlacement,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SpatialPlacementExecutionResolution>;
}

export interface DirectCommandRouteOptions {
  planning: DirectCommandPlanningPort;
  executor: DirectCommandExecutionPort;
  spatial?: SpatialCommandExecutionPort;
  history: DirectCommandHistoryContext;
  clock: Pick<InteractionClock, "now">;
  registry?: DirectCommandExecutionRegistry;
  diagnostics?: DirectCommandTraceDiagnostics;
}

export interface DirectCommandRouteExecuteOptions {
  signal?: AbortSignal;
}

export class DirectCommandRoute {
  private readonly registry: DirectCommandExecutionRegistry;
  private readonly activeControllers = new Set<AbortController>();
  private disposed = false;

  public constructor(private readonly options: DirectCommandRouteOptions) {
    this.registry = options.registry ?? new DirectCommandExecutionRegistry();
  }

  public execute(
    turn: CompletedVoiceTurn,
    executeOptions: DirectCommandRouteExecuteOptions = {},
  ): Promise<DirectCommandRouteResult> {
    if (this.disposed) {
      return Promise.resolve(aborted(turn.id));
    }
    return this.registry.execute(
      turn.id,
      () => this.runOnce(turn, executeOptions),
    );
  }

  public getLastOperation(): DirectOperationRecord | null {
    return this.options.history.getLastSuccessfulOperation();
  }

  public getLastReusableTarget(): DirectReusableTargetRecord | null {
    return this.options.history.getLastReusableTarget();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
    this.registry.clear();
    this.options.history.clear();
  }

  private async runOnce(
    turn: CompletedVoiceTurn,
    executeOptions: DirectCommandRouteExecuteOptions,
  ): Promise<DirectCommandRouteResult> {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (executeOptions.signal?.aborted) {
      controller.abort();
    } else {
      executeOptions.signal?.addEventListener("abort", onExternalAbort, {
        once: true,
      });
    }
    this.activeControllers.add(controller);
    try {
      return await this.executeOnce(turn, controller.signal);
    } finally {
      executeOptions.signal?.removeEventListener("abort", onExternalAbort);
      this.activeControllers.delete(controller);
    }
  }

  private async executeOnce(
    turn: CompletedVoiceTurn,
    signal: AbortSignal,
  ): Promise<DirectCommandRouteResult> {
    const routeReceivedAt = this.now();
    if (signal.aborted || this.disposed) {
      return this.finish(turn, undefined, aborted(turn.id), routeReceivedAt);
    }

    const historySnapshot = this.options.history.snapshot();
    let planning: DirectCommandPlanningResult;
    try {
      planning = await this.options.planning.plan(turn, {
        signal,
        historySnapshot,
        routeReceivedAt,
      });
    } catch {
      return this.finish(
        turn,
        undefined,
        abortedOrPlannerError(turn.id, signal),
        routeReceivedAt,
      );
    }
    if (signal.aborted || this.disposed) {
      return this.finish(turn, planning, aborted(turn.id), routeReceivedAt);
    }
    if (planning.status !== "READY_FOR_EXECUTION") {
      return this.finish(
        turn,
        planning,
        terminalPlanningResult(planning),
        routeReceivedAt,
      );
    }

    if (planning.plan.placementQuery !== undefined) {
      const spatial = await this.executeSpatial(planning, signal);
      return this.finish(
        turn,
        planning,
        spatial.result,
        routeReceivedAt,
        spatial.diagnostics,
      );
    }

    let result: DirectCommandRouteResult;
    switch (planning.plan.relation) {
      case "NEW":
        result = await this.executeNew(planning);
        break;
      case "CONTINUE":
        result = await this.executeContinue(
          planning,
          historySnapshot.lastReusableTarget,
        );
        break;
      case "REVISE_LAST":
        result = await this.executeRevision(
          planning,
          historySnapshot.lastSuccessfulOperation,
          historySnapshot.lastReusableTarget,
        );
        break;
    }
    return this.finish(turn, planning, result, routeReceivedAt);
  }

  private async executeSpatial(
    ready: ReadyForDirectCommandExecution,
    signal: AbortSignal,
  ): Promise<SpatialPlacementExecutionResolution> {
    if (ready.plan.relation !== "NEW" || this.options.spatial === undefined) {
      return {
        result: error(ready, "UNSUPPORTED_CAPABILITY"),
        diagnostics: unavailableSpatialDiagnostics(ready),
      };
    }
    let resolution: SpatialPlacementExecutionResolution;
    try {
      resolution = await this.options.spatial.execute(ready, { signal });
    } catch {
      return {
        result: error(ready, signal.aborted ? "ABORTED" : "COMMIT_FAILED"),
        diagnostics: unavailableSpatialDiagnostics(ready),
      };
    }
    if (resolution.result.status !== "ERROR") {
      this.options.history.recordSuccessfulExecution(ready, resolution.result);
    }
    return resolution;
  }

  private async executeNew(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandRouteResult> {
    let result;
    try {
      result = await this.options.executor.execute(ready);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (result.status !== "ERROR") {
      this.options.history.recordSuccessfulExecution(ready, result);
    }
    return result;
  }

  private async executeContinue(
    ready: ReadyForDirectCommandExecution,
    previousTarget: DirectReusableTargetRecord | null,
  ): Promise<DirectCommandRouteResult> {
    if (
      previousTarget === null
      || ready.target === undefined
      || !isReusableCommand(ready)
      || !isLastTargetQuery(ready.plan.command.target)
    ) {
      return error(ready, "TARGET_NOT_FOUND");
    }
    if (!sameReusableTarget(previousTarget, ready.target)) {
      return error(ready, "INVALID_TARGET");
    }

    const executable = asNewExecution(ready);
    let result;
    try {
      result = await this.options.executor.execute(executable);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (result.status !== "ERROR") {
      this.options.history.recordSuccessfulExecution(ready, result);
    }
    return result;
  }

  private async executeRevision(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord | null,
    previousTarget: DirectReusableTargetRecord | null,
  ): Promise<DirectCommandRouteResult> {
    if (
      previous === null
      || previousTarget === null
      || previous.target.kind !== "grounded"
      || ready.target === undefined
      || !isReusableCommand(ready)
      || !isLastTargetQuery(ready.plan.command.target)
      || !isSupportedRevision(previous, ready)
    ) {
      return error(ready, "REVISE_NOT_AVAILABLE");
    }
    if (
      !sameReusableTarget(previousTarget, ready.target)
      || !sameReusableTarget(previous.target, ready.target)
    ) {
      return error(ready, "INVALID_TARGET");
    }

    let execution;
    try {
      execution = await this.options.executor.revise(ready, previous);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (execution.status === "ERROR") {
      return execution;
    }
    if (execution.status !== "COMMITTED") {
      return error(ready, "REVISE_NOT_AVAILABLE");
    }
    const revised: Extract<DirectCommandRouteResult, { status: "REVISED" }> = {
      status: "REVISED",
      turnId: execution.turnId,
      planId: execution.planId,
      operationId: execution.operationId,
      ...(execution.annotationId === undefined
        ? {}
        : { annotationId: execution.annotationId }),
      ...(execution.executionTimestamps === undefined
        ? {}
        : { executionTimestamps: execution.executionTimestamps }),
    };
    this.options.history.recordSuccessfulExecution(ready, revised);
    return revised;
  }

  private finish(
    turn: CompletedVoiceTurn,
    planning: DirectCommandPlanningResult | undefined,
    result: DirectCommandRouteResult,
    routeReceivedAt: number,
    spatialDiagnostics?: SpatialCommandExecutionDiagnostics,
  ): DirectCommandRouteResult {
    const routeCompletedAt = this.now();
    const executionTimestamps = "executionTimestamps" in result
      ? result.executionTimestamps
      : undefined;
    const timestamps: DirectCommandLifecycleTimestamps = {
      ...(planning?.timestamps ?? { routeReceivedAt }),
      routeReceivedAt,
      ...(turn.completedAt === undefined
        ? {}
        : { voiceFinalizedAt: turn.completedAt }),
      ...(executionTimestamps ?? {}),
      routeCompletedAt,
    };
    const planningDiagnostics = planning?.diagnostics;
    const ready = planning?.status === "READY_FOR_EXECUTION"
      ? planning
      : undefined;
    const plan = ready?.plan;
    const trace: DirectCommandTrace = {
      turnId: turn.id,
      ...(planningDiagnostics?.planId === undefined
        ? plan === undefined ? {} : { planId: plan.planId }
        : { planId: planningDiagnostics.planId }),
      ...(planningDiagnostics?.plannerStatus === undefined
        ? {}
        : { plannerStatus: planningDiagnostics.plannerStatus }),
      ...(planningDiagnostics?.plannerPlacementPresent === undefined
        ? {}
        : { plannerPlacementPresent: planningDiagnostics.plannerPlacementPresent }),
      ...(planningDiagnostics?.plannerDraftPlacementQuery === undefined
        ? {}
        : {
            plannerDraftPlacementQuery:
              planningDiagnostics.plannerDraftPlacementQuery,
          }),
      ...(planningDiagnostics?.spatialPhraseEvidenceKind === undefined
        ? {}
        : { spatialPhraseEvidenceKind: planningDiagnostics.spatialPhraseEvidenceKind }),
      ...(planningDiagnostics?.spatialPhraseEvidenceTokens === undefined
        ? {}
        : {
            spatialPhraseEvidenceTokens: [
              ...planningDiagnostics.spatialPhraseEvidenceTokens,
            ],
          }),
      ...(planningDiagnostics?.normalizedPlacementMode === undefined
        ? {}
        : { normalizedPlacementMode: planningDiagnostics.normalizedPlacementMode }),
      ...(planningDiagnostics?.placementProvenance === undefined
        ? {}
        : { placementProvenance: planningDiagnostics.placementProvenance }),
      ...(planningDiagnostics?.placementConflictRecovered === undefined
        ? {}
        : {
            placementConflictRecovered:
              planningDiagnostics.placementConflictRecovered,
          }),
      ...(planningDiagnostics?.plannerOutputRecovered === undefined
        ? {}
        : { plannerOutputRecovered: planningDiagnostics.plannerOutputRecovered }),
      ...(planningDiagnostics?.placementRecoveryReason === undefined
        ? {}
        : { placementRecoveryReason: planningDiagnostics.placementRecoveryReason }),
      ...(planningDiagnostics?.autoFlowSource === undefined
        ? {}
        : { autoFlowSource: planningDiagnostics.autoFlowSource }),
      ...(planningDiagnostics?.placementChoicePolicy === undefined
        ? {}
        : { placementChoicePolicy: planningDiagnostics.placementChoicePolicy }),
      ...(planningDiagnostics?.effectivePlacementQuery === undefined
        ? {}
        : { effectivePlacementQuery: planningDiagnostics.effectivePlacementQuery }),
      ...(planningDiagnostics?.speechRefinerUsed === undefined
        ? {}
        : { speechRefinerUsed: planningDiagnostics.speechRefinerUsed }),
      ...(planningDiagnostics?.speechRefinerResult === undefined
        ? {}
        : { speechRefinerResult: planningDiagnostics.speechRefinerResult }),
      ...(planningDiagnostics?.speechRefinerErrorCode === undefined
        ? {}
        : {
            speechRefinerErrorCode:
              planningDiagnostics.speechRefinerErrorCode,
          }),
      ...(plan === undefined
        ? {}
        : {
            command: {
              capability: plan.command.capability,
              operation: plan.command.operation,
              relation: plan.relation,
            },
          }),
      ...(planningDiagnostics?.targetQueryKind === undefined
        ? {}
        : { targetQueryKind: planningDiagnostics.targetQueryKind }),
      ...(planningDiagnostics?.targetSlotKind === undefined
        ? {}
        : { targetSlotKind: planningDiagnostics.targetSlotKind }),
      ...(planningDiagnostics?.localTermUniverseSize === undefined
        ? {}
        : {
            localTermUniverseSize:
              planningDiagnostics.localTermUniverseSize,
          }),
      ...(planningDiagnostics?.exactHitCount === undefined
        ? {}
        : { exactHitCount: planningDiagnostics.exactHitCount }),
      ...(planningDiagnostics?.normalizedHitCount === undefined
        ? {}
        : { normalizedHitCount: planningDiagnostics.normalizedHitCount }),
      ...(planningDiagnostics?.fuzzyHitCount === undefined
        ? {}
        : { fuzzyHitCount: planningDiagnostics.fuzzyHitCount }),
      ...(planningDiagnostics?.phoneticHitCount === undefined
        ? {}
        : { phoneticHitCount: planningDiagnostics.phoneticHitCount }),
      ...(planningDiagnostics?.asrAlternativeHitCount === undefined
        ? {}
        : {
            asrAlternativeHitCount:
              planningDiagnostics.asrAlternativeHitCount,
          }),
      ...(planningDiagnostics?.semanticHitCount === undefined
        ? {}
        : { semanticHitCount: planningDiagnostics.semanticHitCount }),
      ...(planningDiagnostics?.mergedCandidateCount === undefined
        ? {}
        : {
            mergedCandidateCount:
              planningDiagnostics.mergedCandidateCount,
          }),
      ...(planningDiagnostics?.startAnchorChunkCount === undefined
        ? {} : { startAnchorChunkCount: planningDiagnostics.startAnchorChunkCount }),
      ...(planningDiagnostics?.endAnchorChunkCount === undefined
        ? {} : { endAnchorChunkCount: planningDiagnostics.endAnchorChunkCount }),
      ...(planningDiagnostics?.startAnchorCandidateCount === undefined
        ? {} : { startAnchorCandidateCount: planningDiagnostics.startAnchorCandidateCount }),
      ...(planningDiagnostics?.endAnchorCandidateCount === undefined
        ? {} : { endAnchorCandidateCount: planningDiagnostics.endAnchorCandidateCount }),
      ...(planningDiagnostics?.multiTokenAnchorUsed === undefined
        ? {} : { multiTokenAnchorUsed: planningDiagnostics.multiTokenAnchorUsed }),
      ...(planningDiagnostics?.anchorVariantCount === undefined
        ? {} : { anchorVariantCount: planningDiagnostics.anchorVariantCount }),
      ...(planningDiagnostics?.canonicalAnchorCount === undefined
        ? {} : { canonicalAnchorCount: planningDiagnostics.canonicalAnchorCount }),
      ...(planningDiagnostics?.dominatedAnchorVariantCount === undefined
        ? {} : {
            dominatedAnchorVariantCount: planningDiagnostics.dominatedAnchorVariantCount,
          }),
      ...(planningDiagnostics?.spanPairCandidateCountBeforePruning === undefined
        ? {} : {
            spanPairCandidateCountBeforePruning:
              planningDiagnostics.spanPairCandidateCountBeforePruning,
          }),
      ...(planningDiagnostics?.dominatedPairCount === undefined
        ? {} : { dominatedPairCount: planningDiagnostics.dominatedPairCount }),
      ...(planningDiagnostics?.spanPairCandidateCountAfterPruning === undefined
        ? {} : {
            spanPairCandidateCountAfterPruning:
              planningDiagnostics.spanPairCandidateCountAfterPruning,
          }),
      ...(planningDiagnostics?.spanPairCandidateCount === undefined
        ? {} : { spanPairCandidateCount: planningDiagnostics.spanPairCandidateCount }),
      ...(planningDiagnostics?.topSpanPairScore === undefined
        ? {} : { topSpanPairScore: planningDiagnostics.topSpanPairScore }),
      ...(planningDiagnostics?.runnerUpSpanPairScore === undefined
        ? {} : { runnerUpSpanPairScore: planningDiagnostics.runnerUpSpanPairScore }),
      ...(planningDiagnostics?.topSpanPairMargin === undefined
        ? {} : { topSpanPairMargin: planningDiagnostics.topSpanPairMargin }),
      ...(planningDiagnostics?.spanPairResolvedDeterministically === undefined
        ? {} : {
            spanPairResolvedDeterministically:
              planningDiagnostics.spanPairResolvedDeterministically,
          }),
      ...(planningDiagnostics?.spanPairRecoveryUsed === undefined
        ? {} : { spanPairRecoveryUsed: planningDiagnostics.spanPairRecoveryUsed }),
      ...(planningDiagnostics?.spanPairRecoveryResult === undefined
        ? {} : { spanPairRecoveryResult: planningDiagnostics.spanPairRecoveryResult }),
      ...(planningDiagnostics?.rawAnchorCandidateCount === undefined
        ? {} : { rawAnchorCandidateCount: planningDiagnostics.rawAnchorCandidateCount }),
      ...(planningDiagnostics?.canonicalAnchorCandidateCount === undefined
        ? {} : {
            canonicalAnchorCandidateCount: planningDiagnostics.canonicalAnchorCandidateCount,
          }),
      ...(planningDiagnostics?.rawPairCandidateCount === undefined
        ? {} : { rawPairCandidateCount: planningDiagnostics.rawPairCandidateCount }),
      ...(planningDiagnostics?.nonDominatedPairCount === undefined
        ? {} : { nonDominatedPairCount: planningDiagnostics.nonDominatedPairCount }),
      ...(planningDiagnostics?.confidenceDecision === undefined
        ? {} : { confidenceDecision: planningDiagnostics.confidenceDecision }),
      ...(planningDiagnostics?.recoveryPairCount === undefined
        ? {} : { recoveryPairCount: planningDiagnostics.recoveryPairCount }),
      ...(planningDiagnostics?.resolutionStatus === undefined
        ? {}
        : { resolutionStatus: planningDiagnostics.resolutionStatus }),
      ...(planningDiagnostics?.resolvedTargetKind === undefined
        ? ready?.target === undefined
          ? {}
          : { resolvedTargetKind: ready.target.kind }
        : { resolvedTargetKind: planningDiagnostics.resolvedTargetKind }),
      ...(planningDiagnostics?.resolverConfidence === undefined
        ? {}
        : { resolverConfidence: planningDiagnostics.resolverConfidence }),
      ...(planningDiagnostics?.candidateCount === undefined
        ? {}
        : { candidateCount: planningDiagnostics.candidateCount }),
      ...(planningDiagnostics?.targetStrategy === undefined
        ? {}
        : { targetStrategy: planningDiagnostics.targetStrategy }),
      ...(planningDiagnostics?.evidenceUsed === undefined
        ? {}
        : { evidenceUsed: { ...planningDiagnostics.evidenceUsed } }),
      ...(planningDiagnostics?.embeddingUsed === undefined
        ? {}
        : { embeddingUsed: planningDiagnostics.embeddingUsed }),
      ...(planningDiagnostics?.embeddingCandidateCount === undefined
        ? {}
        : { embeddingCandidateCount: planningDiagnostics.embeddingCandidateCount }),
      ...(planningDiagnostics?.topSemanticScore === undefined
        ? {}
        : { topSemanticScore: planningDiagnostics.topSemanticScore }),
      ...(planningDiagnostics?.topSemanticMargin === undefined
        ? {}
        : { topSemanticMargin: planningDiagnostics.topSemanticMargin }),
      ...(planningDiagnostics?.queryEmbeddingMs === undefined
        ? {}
        : { queryEmbeddingMs: planningDiagnostics.queryEmbeddingMs }),
      ...(planningDiagnostics?.embeddingSearchMs === undefined
        ? {}
        : { embeddingSearchMs: planningDiagnostics.embeddingSearchMs }),
      ...(planningDiagnostics?.embeddingErrorCode === undefined
        ? {}
        : { embeddingErrorCode: planningDiagnostics.embeddingErrorCode }),
      disambiguationUsed: planningDiagnostics?.disambiguationUsed
        ?? ready?.disambiguationUsed
        ?? false,
      ...(planningDiagnostics?.disambiguationResult === undefined
        ? {}
        : {
            disambiguationResult:
              planningDiagnostics.disambiguationResult,
          }),
      targetRecoveryUsed: planningDiagnostics?.targetRecoveryUsed ?? false,
      ...(planningDiagnostics?.targetRecoveryKind === undefined
        ? {}
        : { targetRecoveryKind: planningDiagnostics.targetRecoveryKind }),
      ...(planningDiagnostics?.recoveryCandidateCount === undefined
        ? {}
        : { recoveryCandidateCount: planningDiagnostics.recoveryCandidateCount }),
      ...(planningDiagnostics?.recoveryResult === undefined
        ? {}
        : { recoveryResult: planningDiagnostics.recoveryResult }),
      ...(planningDiagnostics?.recoveryErrorCode === undefined
        ? {}
        : { recoveryErrorCode: planningDiagnostics.recoveryErrorCode }),
      ...(planningDiagnostics?.initialResolutionReason === undefined
        ? {}
        : { initialResolutionReason: planningDiagnostics.initialResolutionReason }),
      ...(planningDiagnostics?.initialResolutionStatus === undefined
        ? {}
        : { initialResolutionStatus: planningDiagnostics.initialResolutionStatus }),
      ...(planningDiagnostics?.finalResolutionStatus === undefined
        ? {}
        : { finalResolutionStatus: planningDiagnostics.finalResolutionStatus }),
      guardStatus: planningDiagnostics?.guardStatus
        ?? (ready === undefined ? "NOT_RUN" : "PASSED"),
      executionStatus: result.status,
      ...("operationId" in result && result.operationId !== undefined
        ? { editorOperationId: result.operationId }
        : {}),
      ...(result.status === "ERROR"
        ? { errorCode: result.errorCode }
        : {}),
      ...(spatialDiagnostics === undefined
        ? {}
        : { spatial: spatialDiagnostics }),
      timestamps,
      metrics: calculateDirectCommandLatencyMetrics(timestamps),
    };
    try {
      this.options.diagnostics?.record(trace);
    } catch {
      // Diagnostics cannot change route semantics.
    }
    return result;
  }

  private now(): number {
    return Number(this.options.clock.now());
  }
}

function unavailableSpatialDiagnostics(
  ready: ReadyForDirectCommandExecution,
): SpatialCommandExecutionDiagnostics {
  return {
    placementRequested: true,
    pageId: ready.context.frozenContext.pageId,
    sceneRevision: ready.context.frozenContext.sceneRevision,
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
    failureReason: "UNSUPPORTED_CAPABILITY",
    anchorResolutionMs: 0,
    candidateGenerationMs: 0,
    multimodalMs: 0,
    previewValidationMs: 0,
    commitMs: 0,
    totalSpatialMs: 0,
  };
}

function terminalPlanningResult(
  planning: Exclude<
    DirectCommandPlanningResult,
    { status: "READY_FOR_EXECUTION" }
  >,
): DirectCommandRouteResult {
  switch (planning.status) {
    case "DEFERRED_SPATIAL":
    case "NEEDS_CLARIFICATION":
    case "TARGET_NOT_FOUND":
    case "TARGET_AMBIGUOUS":
    case "UNSUPPORTED":
    case "CANCELLED":
      return { status: planning.status, turnId: planning.turnId };
    case "ERROR":
      return {
        status: "ERROR",
        turnId: planning.turnId,
        errorCode: planning.errorCode,
      };
  }
}

function isReusableCommand(
  ready: ReadyForDirectCommandExecution,
): boolean {
  return ready.plan.command.capability === "annotation"
    || ready.plan.command.capability === "text";
}

function isLastTargetQuery(
  target: ReadyForDirectCommandExecution["plan"]["command"]["target"],
): target is TargetQuery {
  return (target.kind === "relative" || target.kind === "object")
    && target.relation === "last_target";
}

function isSupportedRevision(
  previous: DirectOperationRecord,
  ready: ReadyForDirectCommandExecution,
): boolean {
  const command = ready.plan.command;
  return (
    command.capability === "annotation"
    && command.operation === "highlight"
    && previous.command.capability === "annotation"
    && previous.command.operation === "highlight"
  ) || (
    command.capability === "text"
    && previous.command.capability === "text"
  );
}

function sameReusableTarget(
  previous: DirectReusableTargetRecord,
  current: ResolvedTarget,
): boolean {
  return previous.candidateId === current.candidateId
    && previous.pageId === current.pageId
    && previous.source === current.source
    && previous.type === current.type
    && previous.objectId === current.objectId;
}

function asNewExecution(
  ready: ReadyForDirectCommandExecution,
): ReadyForDirectCommandExecution {
  return {
    ...ready,
    plan: {
      ...ready.plan,
      relation: "NEW",
    },
  };
}

function error(
  ready: ReadyForDirectCommandExecution,
  errorCode: Extract<
    DirectCommandRouteResult,
    { status: "ERROR" }
  >["errorCode"],
): Extract<DirectCommandRouteResult, { status: "ERROR" }> {
  return { status: "ERROR", turnId: ready.turnId, errorCode };
}

function aborted(turnId: string): DirectCommandRouteResult {
  return { status: "ERROR", turnId, errorCode: "ABORTED" };
}

function abortedOrPlannerError(
  turnId: string,
  signal: AbortSignal,
): DirectCommandRouteResult {
  return signal.aborted
    ? aborted(turnId)
    : { status: "ERROR", turnId, errorCode: "PLANNER_ERROR" };
}

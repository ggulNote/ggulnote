import type {
  CompletedVoiceTurn,
  DirectCommandContextBuildResult,
  DirectCommandHistorySnapshot,
  DirectCommandName,
  DirectCommandPlannerLastOperation,
  DirectCommandPlannerFocus,
  DirectRecentOperation,
  FrozenPageGroundingSnapshot,
  FrozenSceneSnapshotReference,
  PageTargetCandidate,
} from "../domain";
import { DIRECT_COMMAND_NAMES } from "../domain";
import { buildPageTargetCatalog } from "./page-target-catalog-builder";
import {
  createMinimalSpeechGroundingEvidence,
  TypedSpeechNormalizer,
  type TypedSpeechNormalizerPort,
} from "./typed-speech-normalizer";

export interface FrozenSceneSnapshotSource {
  getSnapshot(
    reference: FrozenSceneSnapshotReference,
  ): FrozenPageGroundingSnapshot | undefined;
}

export interface DirectRecentOperationsSource {
  getRecentOperations(pageId: string): readonly DirectRecentOperation[];
}

export interface DirectCommandContextBuilderOptions {
  frozenSceneSource: FrozenSceneSnapshotSource;
  recentOperationsSource: DirectRecentOperationsSource;
  allowedCommands?: readonly DirectCommandName[];
  maxRecentOperations?: number;
  speechNormalizer?: TypedSpeechNormalizerPort;
}

export interface DirectCommandContextBuildOptions {
  historySnapshot?: DirectCommandHistorySnapshot;
}

export class DirectCommandContextBuilder {
  private readonly allowedCommands: readonly DirectCommandName[];
  private readonly maxRecentOperations: number;
  private readonly speechNormalizer: TypedSpeechNormalizerPort;

  public constructor(private readonly options: DirectCommandContextBuilderOptions) {
    this.allowedCommands = options.allowedCommands ?? DIRECT_COMMAND_NAMES;
    this.maxRecentOperations = positiveInteger(options.maxRecentOperations ?? 8);
    this.speechNormalizer = options.speechNormalizer ?? new TypedSpeechNormalizer();
  }

  public build(
    turn: CompletedVoiceTurn,
    buildOptions: DirectCommandContextBuildOptions = {},
  ): DirectCommandContextBuildResult {
    if (turn.rawTranscript.trim().length === 0) {
      return { status: "ERROR", errorCode: "EMPTY_TRANSCRIPT" };
    }

    const frozenContext = turn.frozenContext;
    const snapshot = this.options.frozenSceneSource.getSnapshot({
      pageId: frozenContext.pageId,
      sceneRevision: frozenContext.sceneRevision,
    });
    if (
      snapshot === undefined
      || snapshot.scene.page.id !== frozenContext.pageId
      || snapshot.scene.sceneRevision !== frozenContext.sceneRevision
      || snapshot.scene.mode !== frozenContext.sceneMode
    ) {
      return { status: "ERROR", errorCode: "STALE_SCENE" };
    }

    const recentOperations = [...this.options.recentOperationsSource
      .getRecentOperations(frozenContext.pageId)]
      .filter((operation) => operation.pageId === frozenContext.pageId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, this.maxRecentOperations);
    const pageTargetCatalog = buildPageTargetCatalog({
      ...(snapshot.documentId === undefined
        ? {}
        : { documentId: snapshot.documentId }),
      scene: snapshot.scene,
      ...(snapshot.semanticModel === undefined
        ? {}
        : { semanticModel: snapshot.semanticModel }),
      recentOperations,
    });
    const focusCandidate = frozenContext.focusObjectId === undefined
      ? undefined
      : pageTargetCatalog.candidates.find(
        (candidate) => candidate.sceneObjectId === frozenContext.focusObjectId,
      );

    if (
      frozenContext.focusObjectId !== undefined
      && !frozenContext.focusStale
      && focusCandidate === undefined
    ) {
      return { status: "ERROR", errorCode: "STALE_SCENE" };
    }

    const plannerFocus = focusCandidate === undefined
      || frozenContext.focusStale
      ? null
      : toPlannerFocus(focusCandidate);
    const plannerContext = {
      turn: {
        turnId: turn.id,
        language: turn.language,
        rawFinalTranscript: turn.rawTranscript,
      },
      frozenContext: {
        pageId: frozenContext.pageId,
        sceneMode: frozenContext.sceneMode,
        sceneRevision: frozenContext.sceneRevision,
        focusSource: frozenContext.focusSource,
        focusStale: frozenContext.focusStale,
        capturedAt: frozenContext.capturedAt,
        focus: plannerFocus,
      },
      recentOperations: recentOperations.map((operation) => {
        const targetType = operation.targetSceneObjectId === undefined
          ? undefined
          : pageTargetCatalog.candidates.find(
            (candidate) =>
              candidate.sceneObjectId === operation.targetSceneObjectId,
          )?.type;
        return {
          operationId: operation.operationId,
          operationType: operation.operationType,
          createdAt: operation.createdAt,
          ...(targetType === undefined ? {} : { targetType }),
        };
      }),
      ...(buildOptions.historySnapshot?.lastSuccessfulOperation === null
        || buildOptions.historySnapshot?.lastSuccessfulOperation === undefined
        ? {}
        : {
            lastOperation: toPlannerLastOperation(
              buildOptions.historySnapshot.lastSuccessfulOperation,
            ),
          }),
      allowedCommands: [...this.allowedCommands],
    } as const;
    let speechGroundingEvidence;
    try {
      speechGroundingEvidence = this.speechNormalizer.normalize({
        rawFinalTranscript: turn.rawTranscript,
        pageTargetCatalog,
        ...(frozenContext.focusObjectId === undefined
          ? {}
          : { focusObjectId: frozenContext.focusObjectId }),
        mode: "command",
      });
    } catch {
      speechGroundingEvidence = createMinimalSpeechGroundingEvidence(
        turn.rawTranscript,
        "NORMALIZER_FAILED",
      );
    }

    return {
      status: "READY",
      context: {
        turn,
        frozenContext,
        pageTargetCatalog,
        recentOperations,
        plannerContext,
        speechGroundingEvidence,
        ...(buildOptions.historySnapshot === undefined
          ? {}
          : { historySnapshot: buildOptions.historySnapshot }),
      },
    };
  }
}

function toPlannerLastOperation(
  record: NonNullable<
    DirectCommandHistorySnapshot["lastSuccessfulOperation"]
  >,
): DirectCommandPlannerLastOperation {
  const targetSummary = record.target.kind === "grounded"
    ? {
        source: record.target.source,
        type: record.target.type,
        ...(record.target.textSummary === undefined
          ? {}
          : { text: record.target.textSummary }),
      }
    : undefined;
  return {
    ...(record.editorOperationId === undefined
      ? {}
      : { operationId: record.editorOperationId }),
    command: record.command,
    ...(targetSummary === undefined ? {} : { targetSummary }),
  };
}

export class CurrentRevisionSceneSnapshotSource
implements FrozenSceneSnapshotSource {
  public constructor(
    private readonly readCurrentSnapshot: () =>
      FrozenPageGroundingSnapshot | undefined,
  ) {}

  public getSnapshot(
    reference: FrozenSceneSnapshotReference,
  ): FrozenPageGroundingSnapshot | undefined {
    const current = this.readCurrentSnapshot();
    if (
      current === undefined
      || current.scene.page.id !== reference.pageId
      || current.scene.sceneRevision !== reference.sceneRevision
    ) {
      return undefined;
    }
    return current;
  }
}

function toPlannerFocus(
  candidate: PageTargetCandidate,
): DirectCommandPlannerFocus {
  return {
    kind: candidate.type,
    source: candidate.source,
    ...(candidate.text === undefined ? {} : { text: candidate.text }),
    editable: candidate.editable,
    annotatable: candidate.annotatable,
    ...(candidate.bounds === undefined
      ? {}
      : { bounds: { ...candidate.bounds } }),
  };
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("maxRecentOperations must be a positive integer.");
  }
  return value;
}

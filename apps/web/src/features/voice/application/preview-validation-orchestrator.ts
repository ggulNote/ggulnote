import type { Rect } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SelectedSpatialPlacement,
  SpatialPlacementQuery,
  SpatialPlacementResult,
  SpatialPreviewResolutionFailureStatus,
  SpatialPreviewValidationFailureReason,
  SpatialPreviewValidationResult,
  SpatialSceneSnapshot,
  ValidatedSpatialPlacement,
} from "../domain";
import type { CurrentSpatialSceneReferenceSource } from "./bounded-multimodal-placement-resolver";
import {
  SpatialPreviewUnavailableError,
  type SpatialPreviewRenderer,
  type SpatialPreviewRendererRegistry,
  type SpatialPreviewSession,
} from "./spatial-preview-renderer";
import { validateSpatialPreview } from "./spatial-preview-validator";

const FALLBACK_ELIGIBLE_REASONS = new Set<SpatialPreviewValidationFailureReason>([
  "OUT_OF_BOUNDS",
  "FOOTPRINT_OVERFLOW",
  "HARD_COLLISION",
  "RELATION_VIOLATION",
  "ALIGNMENT_VIOLATION",
  "OVERLAY_POLICY",
]);

export interface PreviewValidationOrchestratorOptions {
  readonly renderers: SpatialPreviewRendererRegistry;
  readonly currentSceneSource: CurrentSpatialSceneReferenceSource;
  readonly now?: () => number;
}

export interface PreviewValidationInput {
  readonly selected: SelectedSpatialPlacement;
  readonly candidates: readonly PlacementCandidate[];
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly profile: PlacementProfile;
  readonly draft: MeasuredDraft;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly signal?: AbortSignal;
}

export interface SpatialPreviewAttemptDiagnostics {
  readonly candidateInternalId: PlacementCandidate["internalId"];
  readonly requestedBounds: Rect;
  readonly rendererId: string;
  readonly actualRenderBounds?: Rect;
  readonly previewRenderLatencyMs: number;
  readonly validationLatencyMs: number;
  readonly validation?: SpatialPreviewValidationResult;
  readonly failureReason?:
    | SpatialPreviewValidationFailureReason
    | SpatialPreviewResolutionFailureStatus;
  readonly cleanupCompleted: boolean;
}

export interface PreviewValidationDiagnostics {
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly selectedCandidateInternalId: PlacementCandidate["internalId"];
  readonly selectionSource: SelectedSpatialPlacement["source"];
  readonly rendererId?: string;
  readonly previewAttemptCount: 0 | 1 | 2;
  readonly fallbackUsed: boolean;
  readonly attempts: readonly SpatialPreviewAttemptDiagnostics[];
  readonly finalStatus: "VALIDATED" | SpatialPreviewResolutionFailureStatus;
}

export type PreviewValidationResolution =
  | {
      readonly status: "VALIDATED";
      readonly placement: ValidatedSpatialPlacement;
      readonly diagnostics: PreviewValidationDiagnostics;
    }
  | {
      readonly status: SpatialPreviewResolutionFailureStatus;
      readonly reason?: SpatialPreviewValidationFailureReason;
      readonly diagnostics: PreviewValidationDiagnostics;
    };

type AttemptCore =
  | {
      readonly status: "VALID";
      readonly validation: Extract<SpatialPreviewValidationResult, { status: "VALID" }>;
    }
  | {
      readonly status: "INVALID";
      readonly validation: Extract<SpatialPreviewValidationResult, { status: "INVALID" }>;
    }
  | {
      readonly status: Exclude<SpatialPreviewResolutionFailureStatus, "VALIDATION_FAILED">;
    };

type AttemptOutcome = AttemptCore & {
  readonly diagnostics: SpatialPreviewAttemptDiagnostics;
};

export class PreviewValidationOrchestrator {
  private readonly now: () => number;

  public constructor(private readonly options: PreviewValidationOrchestratorOptions) {
    this.now = options.now ?? Date.now;
  }

  public async validate(
    input: PreviewValidationInput,
  ): Promise<PreviewValidationResolution> {
    const selectedCandidate = authoritativeSelectedCandidate(input);
    if (selectedCandidate === undefined || !inputIdentityMatches(input)) {
      return this.failure(
        input,
        "VALIDATION_FAILED",
        [],
        "CANDIDATE_IDENTITY_MISMATCH",
      );
    }
    if (input.profile.capability !== input.draft.capability) {
      return this.failure(
        input,
        "VALIDATION_FAILED",
        [],
        "DRAFT_IDENTITY_MISMATCH",
      );
    }
    if (input.signal?.aborted) {
      return this.failure(input, "ABORTED", []);
    }
    if (!isCurrent(this.options.currentSceneSource, input.snapshot)) {
      return this.failure(input, "STALE_SCENE", []);
    }

    const renderer = this.options.renderers.get(input.draft.capability);
    if (renderer === undefined) {
      return this.failure(input, "PREVIEW_UNAVAILABLE", []);
    }

    const attempts: SpatialPreviewAttemptDiagnostics[] = [];
    const primary = await this.attempt(input, selectedCandidate, renderer);
    attempts.push(primary.diagnostics);
    if (primary.status === "VALID") {
      return this.success(input, selectedCandidate, primary.validation, attempts, false);
    }
    if (primary.status !== "INVALID") {
      return this.failure(input, primary.status, attempts);
    }

    const alternative = FALLBACK_ELIGIBLE_REASONS.has(primary.validation.reason)
      ? firstAlternative(input, selectedCandidate)
      : undefined;
    if (alternative === undefined) {
      return this.failure(
        input,
        "VALIDATION_FAILED",
        attempts,
        primary.validation.reason,
      );
    }
    if (input.signal?.aborted) {
      return this.failure(input, "ABORTED", attempts);
    }
    if (!isCurrent(this.options.currentSceneSource, input.snapshot)) {
      return this.failure(input, "STALE_SCENE", attempts);
    }

    const fallback = await this.attempt(input, alternative, renderer);
    attempts.push(fallback.diagnostics);
    if (fallback.status === "VALID") {
      return this.success(input, alternative, fallback.validation, attempts, true);
    }
    if (fallback.status !== "INVALID") {
      return this.failure(input, fallback.status, attempts);
    }
    return this.failure(
      input,
      "VALIDATION_FAILED",
      attempts,
      fallback.validation.reason,
    );
  }

  private async attempt(
    input: PreviewValidationInput,
    candidate: PlacementCandidate,
    renderer: SpatialPreviewRenderer,
  ): Promise<AttemptOutcome> {
    const renderStartedAt = this.now();
    let renderLatencyMs = 0;
    let validationLatencyMs = 0;
    let session: SpatialPreviewSession | undefined;
    let outcome: AttemptCore | undefined;
    let cleanupCompleted = false;

    try {
      session = await renderer.render({
        scene: input.snapshot,
        candidate,
        draft: input.draft,
        profile: input.profile,
        ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      renderLatencyMs = elapsed(renderStartedAt, this.now());
      if (input.signal?.aborted) {
        outcome = { status: "ABORTED" };
      } else if (!isCurrent(this.options.currentSceneSource, input.snapshot)) {
        outcome = { status: "STALE_SCENE" };
      } else {
        const validationStartedAt = this.now();
        const validation = validateSpatialPreview({
          scene: input.snapshot,
          query: input.query,
          profile: input.profile,
          draft: input.draft,
          candidate,
          preview: session,
          ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
          sceneRevisionMatched: true,
        });
        validationLatencyMs = elapsed(validationStartedAt, this.now());
        outcome = validation.status === "VALID"
          ? { status: "VALID", validation }
          : { status: "INVALID", validation };
      }
    } catch (error) {
      renderLatencyMs = elapsed(renderStartedAt, this.now());
      outcome = input.signal?.aborted
        ? { status: "ABORTED" }
        : error instanceof SpatialPreviewUnavailableError
          ? { status: "PREVIEW_UNAVAILABLE" }
          : { status: "PREVIEW_RENDER_FAILED" };
      cleanupCompleted = session === undefined;
    } finally {
      if (session !== undefined) {
        try {
          await session.dispose();
          cleanupCompleted = true;
        } catch {
          cleanupCompleted = false;
          outcome = { status: "PREVIEW_RENDER_FAILED" };
        }
      }
    }

    const resolvedOutcome = outcome ?? { status: "PREVIEW_RENDER_FAILED" as const };
    const failureReason = resolvedOutcome.status === "INVALID"
      ? resolvedOutcome.validation.reason
      : resolvedOutcome.status === "VALID"
        ? undefined
        : resolvedOutcome.status;
    const diagnostics: SpatialPreviewAttemptDiagnostics = Object.freeze({
      candidateInternalId: candidate.internalId,
      requestedBounds: freezeRect(candidate.bounds),
      rendererId: renderer.id,
      ...(session === undefined
        ? {}
        : { actualRenderBounds: freezeRect(session.actualRenderBounds) }),
      previewRenderLatencyMs: renderLatencyMs,
      validationLatencyMs,
      ...(resolvedOutcome.status === "VALID" || resolvedOutcome.status === "INVALID"
        ? { validation: resolvedOutcome.validation }
        : {}),
      ...(failureReason === undefined ? {} : { failureReason }),
      cleanupCompleted,
    });
    return { ...resolvedOutcome, diagnostics } as AttemptOutcome;
  }

  private success(
    input: PreviewValidationInput,
    candidate: PlacementCandidate,
    validation: Extract<SpatialPreviewValidationResult, { status: "VALID" }>,
    attempts: readonly SpatialPreviewAttemptDiagnostics[],
    fallbackUsed: boolean,
  ): PreviewValidationResolution {
    const previewAttemptCount = attempts.length as 1 | 2;
    const placement: ValidatedSpatialPlacement = Object.freeze({
      snapshotId: input.snapshot.snapshotId,
      pageId: input.snapshot.pageId,
      sceneRevision: input.snapshot.sceneRevision,
      candidate,
      candidateInternalId: candidate.internalId,
      draftKey: input.draft.draftKey,
      requestedBounds: freezeRect(candidate.bounds),
      actualRenderBounds: freezeRect(validation.actualRenderBounds),
      selectionSource: fallbackUsed
        ? "VALIDATION_FALLBACK"
        : input.selected.source,
      previewAttemptCount,
      validationEvidence: validation.evidence,
    });
    return {
      status: "VALIDATED",
      placement,
      diagnostics: diagnostics(input, attempts, "VALIDATED", fallbackUsed),
    };
  }

  private failure(
    input: PreviewValidationInput,
    status: SpatialPreviewResolutionFailureStatus,
    attempts: readonly SpatialPreviewAttemptDiagnostics[],
    reason?: SpatialPreviewValidationFailureReason,
  ): PreviewValidationResolution {
    return {
      status,
      ...(reason === undefined ? {} : { reason }),
      diagnostics: diagnostics(input, attempts, status, attempts.length > 1),
    };
  }
}

export function selectedSpatialPlacementFromResult(
  result: SpatialPlacementResult,
): SelectedSpatialPlacement | undefined {
  return result.status === "RESOLVED"
    ? Object.freeze({
        snapshotId: result.placement.snapshotId,
        pageId: result.placement.pageId,
        sceneRevision: result.placement.sceneRevision,
        candidate: result.placement.candidate,
        source: result.source,
      })
    : undefined;
}

function inputIdentityMatches(input: PreviewValidationInput): boolean {
  return input.selected.snapshotId === input.snapshot.snapshotId
    && input.selected.pageId === input.snapshot.pageId
    && input.selected.sceneRevision === input.snapshot.sceneRevision
    && input.selected.candidate.snapshotId === input.snapshot.snapshotId
    && input.selected.candidate.sceneRevision === input.snapshot.sceneRevision;
}

function authoritativeSelectedCandidate(
  input: PreviewValidationInput,
): PlacementCandidate | undefined {
  return input.candidates.find((candidate) =>
    sameCandidateIdentity(candidate, input.selected.candidate),
  );
}

function firstAlternative(
  input: PreviewValidationInput,
  selected: PlacementCandidate,
): PlacementCandidate | undefined {
  return input.candidates.find((candidate) =>
    candidate.internalId !== selected.internalId
    && candidate.snapshotId === input.snapshot.snapshotId
    && candidate.sceneRevision === input.snapshot.sceneRevision
    && candidate.relation === input.query.relation,
  );
}

function sameCandidateIdentity(
  left: PlacementCandidate,
  right: PlacementCandidate,
): boolean {
  return left.internalId === right.internalId
    && left.snapshotId === right.snapshotId
    && left.sceneRevision === right.sceneRevision
    && left.relation === right.relation
    && sameRect(left.bounds, right.bounds);
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function isCurrent(
  source: CurrentSpatialSceneReferenceSource,
  snapshot: SpatialSceneSnapshot,
): boolean {
  const current = source.getCurrentReference();
  return current?.pageId === snapshot.pageId
    && current.sceneRevision === snapshot.sceneRevision;
}

function diagnostics(
  input: PreviewValidationInput,
  attempts: readonly SpatialPreviewAttemptDiagnostics[],
  finalStatus: PreviewValidationDiagnostics["finalStatus"],
  fallbackUsed: boolean,
): PreviewValidationDiagnostics {
  return Object.freeze({
    pageId: input.snapshot.pageId,
    sceneRevision: input.snapshot.sceneRevision,
    selectedCandidateInternalId: input.selected.candidate.internalId,
    selectionSource: input.selected.source,
    ...(attempts[0] === undefined ? {} : { rendererId: attempts[0].rendererId }),
    previewAttemptCount: attempts.length as 0 | 1 | 2,
    fallbackUsed,
    attempts: Object.freeze([...attempts]),
    finalStatus,
  });
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

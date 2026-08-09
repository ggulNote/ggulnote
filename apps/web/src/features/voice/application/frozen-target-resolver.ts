import type {
  CandidateEvidence,
  PageTargetCandidate,
  ResolvedTarget,
  TargetQuery,
  TargetResolutionInput,
  TargetResolutionPolicy,
  TargetResolutionResult,
} from "../domain";
import { DEFAULT_TARGET_RESOLUTION_POLICY } from "../domain";
import { rankTargetCandidates } from "./candidate-ranker";

const TEXT_LIKE_TARGET_TYPES = new Set([
  "sentence",
  "paragraph",
  "line",
  "word",
  "text",
]);

export class FrozenTargetResolver {
  public constructor(
    private readonly policy: TargetResolutionPolicy =
      DEFAULT_TARGET_RESOLUTION_POLICY,
  ) {
    assertPolicy(policy);
  }

  public resolve(input: TargetResolutionInput): TargetResolutionResult {
    if (
      input.catalog.pageId !== input.frozenContext.pageId
      || input.catalog.sceneRevision !== input.frozenContext.sceneRevision
    ) {
      return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    }
    if (input.query.kind === "subrange") {
      return { status: "NOT_FOUND", reasonCode: "SUBRANGE_UNSUPPORTED" };
    }

    const relation = relationForQuery(input.query);
    if (relation === "focused") {
      return this.resolveFocused(input);
    }
    if (relation === "last_target") {
      return this.resolveLastTarget(input);
    }
    return this.resolveRanked(input);
  }

  private resolveFocused(
    input: TargetResolutionInput,
  ): TargetResolutionResult {
    const objectId = input.frozenContext.focusObjectId;
    if (objectId === undefined || input.frozenContext.focusStale) {
      return { status: "NOT_FOUND", reasonCode: "FOCUS_NOT_AVAILABLE" };
    }
    const candidate = input.catalog.candidates.find(
      (entry) => entry.sceneObjectId === objectId,
    );
    if (candidate === undefined || !candidateMatchesExplicitType(candidate, input.query)) {
      return { status: "NOT_FOUND", reasonCode: "FOCUS_NOT_AVAILABLE" };
    }
    return resolvedCandidate(
      candidate,
      input.query,
      {
        ...emptyEvidence(),
        typeMatch: 1,
        structuralMatch: 1,
        focusMatch: 1,
      },
      input.catalog.sceneRevision,
    );
  }

  private resolveLastTarget(
    input: TargetResolutionInput,
  ): TargetResolutionResult {
    const operation = [...input.recentOperations]
      .sort((left, right) => right.createdAt - left.createdAt)
      .find((entry) => entry.targetSceneObjectId !== undefined);
    if (operation?.targetSceneObjectId === undefined) {
      return { status: "NOT_FOUND", reasonCode: "LAST_TARGET_NOT_AVAILABLE" };
    }
    const candidate = input.catalog.candidates.find(
      (entry) => entry.sceneObjectId === operation.targetSceneObjectId,
    );
    if (candidate === undefined || !candidateMatchesExplicitType(candidate, input.query)) {
      return { status: "NOT_FOUND", reasonCode: "LAST_TARGET_NOT_AVAILABLE" };
    }
    return resolvedCandidate(
      candidate,
      input.query,
      {
        ...emptyEvidence(),
        typeMatch: 1,
        temporalMatch: 1,
        structuralMatch: 1,
        focusMatch: input.frozenContext.focusObjectId === undefined
          ? null
          : candidate.sceneObjectId === input.frozenContext.focusObjectId
            ? 1
            : 0,
      },
      input.catalog.sceneRevision,
    );
  }

  private resolveRanked(input: TargetResolutionInput): TargetResolutionResult {
    const ranked = rankTargetCandidates(input);
    const first = ranked[0];
    if (first === undefined) {
      return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    }
    if (first.score < this.policy.minResolvedScore) {
      return { status: "NOT_FOUND", reasonCode: "LOW_CONFIDENCE" };
    }

    const second = ranked[1];
    if (
      second !== undefined
      && first.score - second.score < this.policy.minResolvedMargin
    ) {
      return {
        status: "AMBIGUOUS",
        candidates: ranked.slice(0, this.policy.maxAmbiguousCandidates),
        reasonCode: "AMBIGUOUS_MATCH",
      };
    }
    return resolvedCandidate(
      first.candidate,
      input.query,
      first.evidence,
      input.catalog.sceneRevision,
      first.score,
    );
  }
}

function relationForQuery(
  query: TargetQuery,
): "focused" | "last_target" | "recent" | undefined {
  switch (query.kind) {
    case "relative":
    case "object":
      return query.relation;
    case "semantic_unit":
      return query.relation;
    case "text_span":
    case "subrange":
      return undefined;
  }
}

function candidateMatchesExplicitType(
  candidate: PageTargetCandidate,
  query: TargetQuery,
): boolean {
  if (query.kind === "subrange") return false;
  if (query.kind === "object") return candidate.type === query.objectType;
  if (query.kind === "relative" && query.objectType !== undefined) {
    return candidate.type === query.objectType;
  }
  if (query.kind === "semantic_unit") {
    return candidate.semanticUnit === query.unit;
  }
  return candidate.text !== undefined;
}

function resolvedCandidate(
  candidate: PageTargetCandidate,
  query: TargetQuery,
  evidence: CandidateEvidence,
  sceneRevision: number,
  confidence = 1,
): TargetResolutionResult {
  const target = toResolvedTarget(candidate, query, sceneRevision);
  if (target === null) {
    return { status: "NOT_FOUND", reasonCode: "TARGET_KIND_UNSUPPORTED" };
  }
  return {
    status: "RESOLVED",
    target,
    confidence,
    evidence,
  };
}

function toResolvedTarget(
  candidate: PageTargetCandidate,
  query: TargetQuery,
  sceneRevision: number,
): ResolvedTarget | null {
  if (query.kind === "subrange") return null;
  const base = {
    candidateId: candidate.candidateId,
    pageId: candidate.pageId,
    sceneRevision,
    source: candidate.source,
    type: candidate.type,
    editable: candidate.editable,
    annotatable: candidate.annotatable,
  };

  if (
    query.kind === "object"
    || candidate.text === undefined
    || !TEXT_LIKE_TARGET_TYPES.has(candidate.type)
  ) {
    if (candidate.sceneObjectId === undefined) return null;
    return {
      ...base,
      kind: "object",
      objectId: candidate.sceneObjectId,
      ...(candidate.bounds === undefined ? {} : { bounds: { ...candidate.bounds } }),
    };
  }
  return {
    ...base,
    kind: "text_span",
    ...(candidate.sceneObjectId === undefined
      ? {}
      : { objectId: candidate.sceneObjectId }),
    text: candidate.text,
    ...(candidate.bounds === undefined
      ? {}
      : { bounds: [{ ...candidate.bounds }] }),
  };
}

function emptyEvidence(): CandidateEvidence {
  return {
    typeMatch: null,
    lexicalMatch: null,
    fuzzyMatch: null,
    semanticMatch: null,
    mathMatch: null,
    temporalMatch: null,
    structuralMatch: null,
    focusMatch: null,
  };
}

function assertPolicy(policy: TargetResolutionPolicy): void {
  if (
    !Number.isFinite(policy.minResolvedScore)
    || policy.minResolvedScore < 0
    || policy.minResolvedScore > 1
    || !Number.isFinite(policy.minResolvedMargin)
    || policy.minResolvedMargin < 0
    || policy.minResolvedMargin > 1
    || !Number.isInteger(policy.maxAmbiguousCandidates)
    || policy.maxAmbiguousCandidates <= 0
  ) {
    throw new RangeError("Invalid target resolution policy.");
  }
}

import type {
  CandidateEvidence,
  PageTargetCandidate,
  ResolvedTarget,
  TargetQuery,
  TargetResolutionInput,
  TargetResolutionPolicy,
  TargetResolutionResult,
  TextSpanTargetQuery,
} from "../domain";
import { DEFAULT_TARGET_RESOLUTION_POLICY } from "../domain";
import {
  buildCanonicalTextStream,
  resolveTextSpanWithCanonicalStream,
  type TextSpanRangeResolution,
} from "./canonical-text-stream";
import {
  countTextSpanAnchorChunks,
  groundTextSpan,
  type TextSpanGroundingDiagnostics,
} from "./text-span-grounder";
import { rankTargetCandidates } from "./candidate-ranker";
import {
  TargetStrategyRouter,
  type TargetStrategyResolveOptions,
} from "./target-strategy-router";
import type { Rect } from "@ggulnote/editor-core";

const TEXT_LIKE_TARGET_TYPES = new Set([
  "sentence",
  "paragraph",
  "line",
  "word",
  "text",
]);

export class FrozenTargetResolver {
  private readonly policy: TargetResolutionPolicy;
  private readonly strategyRouter?: TargetStrategyRouter;

  public constructor(
    policyOrOptions: TargetResolutionPolicy | {
      policy?: TargetResolutionPolicy;
      strategyRouter?: TargetStrategyRouter;
    } = DEFAULT_TARGET_RESOLUTION_POLICY,
  ) {
    this.policy = isTargetResolutionPolicy(policyOrOptions)
      ? policyOrOptions
      : policyOrOptions.policy ?? DEFAULT_TARGET_RESOLUTION_POLICY;
    this.strategyRouter = isTargetResolutionPolicy(policyOrOptions)
      ? undefined
      : policyOrOptions.strategyRouter;
    assertPolicy(this.policy);
  }

  public resolveAsync(
    input: TargetResolutionInput,
    options: TargetStrategyResolveOptions = {},
  ): Promise<TargetResolutionResult> {
    if (this.strategyRouter === undefined) {
      return Promise.resolve(this.resolve(input));
    }
    return this.strategyRouter.resolve(input, {
      resolveDeterministic: (nextInput) => this.resolve(nextInput),
      resolveRankedCandidate: (nextInput, candidate) =>
        this.resolveRankedCandidate(nextInput, candidate),
    }, options);
  }

  public resolve(input: TargetResolutionInput): TargetResolutionResult {
    if (
      input.catalog.pageId !== input.frozenContext.pageId
      || input.catalog.sceneRevision !== input.frozenContext.sceneRevision
    ) {
      return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    }
    if (input.query.kind === "text_span" && input.catalog.semanticModel !== undefined) {
      const canonical = this.resolveTextSpanCanonical(input, input.query);
      if (canonical !== undefined) {
        return canonical;
      }
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

  public resolveRankedCandidate(
    input: TargetResolutionInput,
    rankedCandidate: { candidate: PageTargetCandidate; score: number; evidence: CandidateEvidence },
  ): TargetResolutionResult {
    const candidate = input.catalog.candidates.find(
      (entry) => entry.candidateId === rankedCandidate.candidate.candidateId,
    );
    if (
      candidate === undefined
      || candidate.pageId !== input.frozenContext.pageId
      || input.catalog.sceneRevision !== input.frozenContext.sceneRevision
    ) {
      return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    }
    return resolvedCandidate(
      candidate,
      input.query,
      rankedCandidate.evidence,
      input.catalog.sceneRevision,
      rankedCandidate.score,
    );
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
    const reusableTarget = input.lastReusableTarget;
    if (reusableTarget !== undefined) {
      if (reusableTarget.pageId !== input.frozenContext.pageId) {
        return { status: "NOT_FOUND", reasonCode: "LAST_TARGET_NOT_AVAILABLE" };
      }
      const candidate = input.catalog.candidates.find(
        (entry) =>
          entry.candidateId === reusableTarget.candidateId
          && entry.pageId === reusableTarget.pageId
          && entry.source === reusableTarget.source
          && entry.type === reusableTarget.type
          && (
            reusableTarget.objectId === undefined
            || entry.sceneObjectId === reusableTarget.objectId
          ),
      );
      if (
        candidate === undefined
        || !candidateMatchesExplicitType(candidate, input.query)
      ) {
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

  private resolveTextSpanCanonical(
    input: TargetResolutionInput,
    query: TextSpanTargetQuery,
  ): TargetResolutionResult | undefined {
    if (input.catalog.semanticModel === undefined) {
      return undefined;
    }
    const boundsBySourceObjectId = new Map<string, Rect>();
    const sourceObjectCandidates = new Map<string, PageTargetCandidate>();
    for (const candidate of input.catalog.candidates) {
      if (
        candidate.source === "pdf"
        && candidate.sourceObjectId !== undefined
        && candidate.bounds !== undefined
      ) {
        const bounds = candidate.bounds;
        boundsBySourceObjectId.set(candidate.sourceObjectId, { ...bounds });
        sourceObjectCandidates.set(candidate.sourceObjectId, candidate);
      }
    }
    if (boundsBySourceObjectId.size === 0) {
      return undefined;
    }

    const stream = buildCanonicalTextStream({
      semanticModel: input.catalog.semanticModel,
      pageId: input.frozenContext.pageId,
      boundsBySourceObjectId,
    });
    const resolution = resolveTextSpanWithCanonicalStream(stream, query);
    if (resolution.status === "RESOLVED") {
      return this.toResolvedTextSpan(
        input,
        resolution,
        sourceObjectCandidates,
        1,
        exactTextSpanDiagnostics(query),
      );
    }

    const grounding = groundTextSpan({
      stream,
      query,
      ...(input.speechGroundingEvidence === undefined
        ? {}
        : { speechEvidence: input.speechGroundingEvidence }),
      ...(input.frozenContext.focusObjectId === undefined
        ? {}
        : { focusObjectId: input.frozenContext.focusObjectId }),
    });
    if (grounding.status === "RESOLVED") {
      return this.toResolvedTextSpan(
        input,
        grounding.pair.materialized,
        sourceObjectCandidates,
        grounding.pair.score,
        grounding.diagnostics,
      );
    }
    return {
      status: "NOT_FOUND",
      reasonCode: grounding.status === "AMBIGUOUS" ? "LOW_CONFIDENCE" : "NO_MATCH",
      diagnostics: targetTextSpanDiagnostics(grounding.diagnostics),
    };
  }

  private toResolvedTextSpan(
    input: TargetResolutionInput,
    resolution: Extract<TextSpanRangeResolution, { status: "RESOLVED" }>,
    sourceObjectCandidates: ReadonlyMap<string, PageTargetCandidate>,
    confidence: number,
    diagnostics: TextSpanGroundingDiagnostics,
  ): TargetResolutionResult | undefined {
    const sourceObjectId = resolution.selectedTokens[0]?.sourceObjectId;
    const startCandidate = sourceObjectId === undefined
      ? undefined
      : sourceObjectCandidates.get(sourceObjectId);
    if (startCandidate === undefined || startCandidate.source === "ggulnote") return undefined;
    return {
      status: "RESOLVED",
      confidence,
      target: {
        candidateId: startCandidate.candidateId,
        kind: "text_span",
        pageId: startCandidate.pageId,
        sceneRevision: input.catalog.sceneRevision,
        source: startCandidate.source,
        type: startCandidate.type,
        editable: startCandidate.editable,
        annotatable: startCandidate.annotatable,
        ...(startCandidate.sceneObjectId === undefined
          ? {}
          : { objectId: startCandidate.sceneObjectId }),
        text: resolution.text,
        bounds: [...resolution.bounds],
      },
      evidence: {
        ...emptyEvidence(),
        typeMatch: 1,
        lexicalMatch: confidence,
        fuzzyMatch: confidence,
      },
      diagnostics: targetTextSpanDiagnostics(diagnostics),
    };
  }

  private resolveRanked(input: TargetResolutionInput): TargetResolutionResult {
    const ranked = rankTargetCandidates(input);
    const first = ranked[0];
    if (first === undefined) {
      return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    }
    if (first.score < this.policy.minResolvedScore) {
      return {
        status: "NOT_FOUND",
        reasonCode: "LOW_CONFIDENCE",
        recoveryCandidates: ranked.slice(0, this.policy.maxAmbiguousCandidates),
      };
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

function exactTextSpanDiagnostics(query: TextSpanTargetQuery): TextSpanGroundingDiagnostics {
  const startChunks = countTextSpanAnchorChunks(query.quote ?? query.startAnchor ?? "");
  const endChunks = countTextSpanAnchorChunks(query.quote ?? query.endAnchor ?? "");
  return {
    startAnchorChunkCount: startChunks,
    endAnchorChunkCount: endChunks,
    startAnchorCandidateCount: 1,
    endAnchorCandidateCount: 1,
    multiTokenAnchorUsed: startChunks > 1 || endChunks > 1,
    spanPairCandidateCount: 1,
    topSpanPairScore: 1,
    topSpanPairMargin: 1,
    spanPairResolvedDeterministically: true,
  };
}

function targetTextSpanDiagnostics(
  diagnostics: TextSpanGroundingDiagnostics,
): NonNullable<TargetResolutionResult["diagnostics"]> {
  return {
    targetStrategy: "text_span",
    evidenceUsed: {
      type: true,
      lexical: true,
      fuzzy: true,
      embedding: false,
      structure: true,
      focus: false,
      temporal: false,
    },
    embeddingUsed: false,
    embeddingCandidateCount: 0,
    ...diagnostics,
  };
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

function isTargetResolutionPolicy(
  value: TargetResolutionPolicy | {
    policy?: TargetResolutionPolicy;
    strategyRouter?: TargetStrategyRouter;
  },
): value is TargetResolutionPolicy {
  return "minResolvedScore" in value
    && "minResolvedMargin" in value
    && "maxAmbiguousCandidates" in value;
}

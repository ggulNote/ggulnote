import type {
  CandidateEvidence,
  PageTargetCandidate,
  RankedTargetCandidate,
  TargetEvidenceUsage,
  TargetQuery,
  TargetResolutionDiagnostics,
  TargetResolutionInput,
  TargetResolutionResult,
} from "../domain";
import { rankTargetCandidates } from "./candidate-ranker";
import { TARGET_STRATEGY_CONFIG } from "./target-resolution-policy";

const DEFAULT_EMBEDDING_TOP_K = 8;
const DEFAULT_MAX_SUBRANGE_DEPTH = 4;

export interface TargetEmbeddingSearch {
  embedQuery(
    text: string,
    options?: { signal?: AbortSignal },
  ): Promise<Float32Array>;
  searchVector(input: {
    documentId: string;
    pageId: string;
    granularity: "sentence" | "paragraph" | "canvas_text";
    queryVector: Float32Array;
    topK: number;
  }): Promise<readonly { sourceObjectId: string; score: number }[]>;
}

export interface TargetStrategyResolutionPort {
  resolveDeterministic(input: TargetResolutionInput): TargetResolutionResult;
  resolveRankedCandidate(
    input: TargetResolutionInput,
    candidate: RankedTargetCandidate,
  ): TargetResolutionResult;
}

export interface TargetStrategyRouterOptions {
  embeddingSearch?: TargetEmbeddingSearch;
  embeddingTopK?: number;
  maxSubrangeDepth?: number;
  policies?: Partial<Readonly<Record<TargetQuery["kind"], {
    minResolvedScore: number;
    minResolvedMargin: number;
    maxAmbiguousCandidates: number;
  }>>>;
  now?: () => number;
}

export interface TargetStrategyResolveOptions {
  signal?: AbortSignal;
}

interface SemanticEvidenceResult {
  matches: ReadonlyMap<string, number>;
  used: boolean;
  candidateCount: number;
  topScore?: number;
  topMargin?: number;
  queryEmbeddingMs?: number;
  searchMs?: number;
  errorCode?: string;
}

export class TargetStrategyRouter {
  private readonly embeddingTopK: number;
  private readonly maxSubrangeDepth: number;
  private readonly now: () => number;
  private readonly inFlightQueryEmbeddings = new Map<string, Promise<Float32Array>>();

  public constructor(private readonly options: TargetStrategyRouterOptions = {}) {
    this.embeddingTopK = positiveInteger(
      options.embeddingTopK ?? DEFAULT_EMBEDDING_TOP_K,
      "embeddingTopK",
    );
    this.maxSubrangeDepth = positiveInteger(
      options.maxSubrangeDepth ?? DEFAULT_MAX_SUBRANGE_DEPTH,
      "maxSubrangeDepth",
    );
    this.now = options.now ?? Date.now;
  }

  public resolve(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    options: TargetStrategyResolveOptions = {},
  ): Promise<TargetResolutionResult> {
    return this.resolveAtDepth(input, port, options, 0);
  }

  private async resolveAtDepth(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    options: TargetStrategyResolveOptions,
    depth: number,
  ): Promise<TargetResolutionResult> {
    if (
      input.catalog.pageId !== input.frozenContext.pageId
      || input.catalog.sceneRevision !== input.frozenContext.sceneRevision
    ) {
      return port.resolveDeterministic(input);
    }
    switch (input.query.kind) {
      case "relative":
      case "text_span":
        return withDiagnostics(
          input.query.kind,
          port.resolveDeterministic(input),
        );
      case "semantic_unit":
        return this.resolveSemanticUnit(input, port, options);
      case "object":
        return this.resolveObject(input, port, options);
      case "subrange":
        return this.resolveSubrange(input, port, options, depth);
      default:
        return {
          status: "NOT_FOUND",
          reasonCode: "TARGET_KIND_UNSUPPORTED",
        };
    }
  }

  private async resolveSemanticUnit(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    options: TargetStrategyResolveOptions,
  ): Promise<TargetResolutionResult> {
    if (input.query.kind !== "semantic_unit") return unsupported("semantic_unit");
    if (input.query.relation === "focused") {
      return withDiagnostics("semantic_unit", port.resolveDeterministic(input));
    }
    const granularity = input.query.unit === "sentence"
      ? "sentence" as const
      : input.query.unit === "paragraph"
        ? "paragraph" as const
        : undefined;
    const semantic = granularity === undefined || input.query.query === undefined
      ? emptySemanticEvidence()
      : await this.searchSemanticEvidence(
          input,
          input.query.query,
          granularity,
          options.signal,
        );
    return withDiagnostics(
      "semantic_unit",
      this.resolveRanked(input, port, semantic.matches),
      semantic,
    );
  }

  private async resolveObject(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    options: TargetStrategyResolveOptions,
  ): Promise<TargetResolutionResult> {
    if (input.query.kind !== "object") return unsupported("object");
    if (input.query.relation === "focused" || input.query.relation === "last_target") {
      return withDiagnostics("object", port.resolveDeterministic(input));
    }
    const semantic = input.query.objectType === "text" && input.query.query !== undefined
      ? await this.searchSemanticEvidence(
          input,
          input.query.query,
          "canvas_text",
          options.signal,
        )
      : emptySemanticEvidence();
    return withDiagnostics(
      "object",
      this.resolveRanked(input, port, semantic.matches),
      semantic,
    );
  }

  private async resolveSubrange(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    options: TargetStrategyResolveOptions,
    depth: number,
  ): Promise<TargetResolutionResult> {
    if (input.query.kind !== "subrange") return unsupported("subrange");
    if (depth >= this.maxSubrangeDepth) {
      return withDiagnostics("subrange", {
        status: "NOT_FOUND",
        reasonCode: "SUBRANGE_UNSUPPORTED",
      });
    }
    const parent = await this.resolveAtDepth(
      { ...input, query: input.query.parent },
      port,
      options,
      depth + 1,
    );
    if (parent.status !== "RESOLVED") {
      return withDiagnostics("subrange", stripDiagnostics(parent));
    }
    return withDiagnostics("subrange", {
      status: "NOT_FOUND",
      reasonCode: "SUBRANGE_UNSUPPORTED",
    });
  }

  private resolveRanked(
    input: TargetResolutionInput,
    port: TargetStrategyResolutionPort,
    semanticMatches: ReadonlyMap<string, number>,
  ): TargetResolutionResult {
    const config = TARGET_STRATEGY_CONFIG[input.query.kind];
    const policy = this.options.policies?.[input.query.kind] ?? config.policy;
    const ranked = rankTargetCandidates(input, {
      weights: config.weights,
      semanticMatches,
    });
    const first = ranked[0];
    if (first === undefined) return { status: "NOT_FOUND", reasonCode: "NO_MATCH" };
    if (first.score < policy.minResolvedScore) {
      return { status: "NOT_FOUND", reasonCode: "LOW_CONFIDENCE" };
    }
    const second = ranked[1];
    if (second !== undefined && first.score - second.score < policy.minResolvedMargin) {
      return {
        status: "AMBIGUOUS",
        candidates: ranked.slice(0, policy.maxAmbiguousCandidates),
        reasonCode: "AMBIGUOUS_MATCH",
      };
    }
    return port.resolveRankedCandidate(input, first);
  }

  private async searchSemanticEvidence(
    input: TargetResolutionInput,
    text: string,
    granularity: "sentence" | "paragraph" | "canvas_text",
    signal?: AbortSignal,
  ): Promise<SemanticEvidenceResult> {
    const search = this.options.embeddingSearch;
    const documentId = input.catalog.documentId;
    if (search === undefined || documentId === undefined || text.trim().length === 0) {
      return emptySemanticEvidence();
    }
    const queryKey = `${documentId}:${input.catalog.pageId}:${granularity}:${text.normalize("NFKC")}`;
    const queryStartedAt = this.now();
    try {
      let queryPromise = this.inFlightQueryEmbeddings.get(queryKey);
      if (queryPromise === undefined) {
        queryPromise = search.embedQuery(text, { signal });
        this.inFlightQueryEmbeddings.set(queryKey, queryPromise);
        void queryPromise.finally(() => {
          if (this.inFlightQueryEmbeddings.get(queryKey) === queryPromise) {
            this.inFlightQueryEmbeddings.delete(queryKey);
          }
        }).catch(() => undefined);
      }
      const queryVector = await queryPromise;
      const queryCompletedAt = this.now();
      const searchResults = await search.searchVector({
        documentId,
        pageId: input.catalog.pageId,
        granularity,
        queryVector,
        topK: this.embeddingTopK,
      });
      const searchCompletedAt = this.now();
      const candidatesBySourceId = candidateMapByEmbeddingSource(input, granularity);
      const matches = new Map<string, number>();
      const matchedScores: number[] = [];
      for (const result of searchResults) {
        const score = normalizeCosineScore(result.score);
        for (const candidate of candidatesBySourceId.get(result.sourceObjectId) ?? []) {
          matches.set(candidate.candidateId, score);
          matchedScores.push(score);
        }
      }
      matchedScores.sort((left, right) => right - left);
      return {
        matches,
        used: true,
        candidateCount: matches.size,
        ...(matchedScores[0] === undefined ? {} : { topScore: matchedScores[0] }),
        ...(matchedScores[0] === undefined || matchedScores[1] === undefined
          ? {}
          : { topMargin: matchedScores[0] - matchedScores[1] }),
        queryEmbeddingMs: Math.max(0, queryCompletedAt - queryStartedAt),
        searchMs: Math.max(0, searchCompletedAt - queryCompletedAt),
      };
    } catch (error) {
      return { ...emptySemanticEvidence(), errorCode: embeddingErrorCode(error) };
    }
  }
}

function candidateMapByEmbeddingSource(
  input: TargetResolutionInput,
  granularity: "sentence" | "paragraph" | "canvas_text",
): ReadonlyMap<string, readonly PageTargetCandidate[]> {
  const result = new Map<string, PageTargetCandidate[]>();
  for (const candidate of input.catalog.candidates) {
    const matchesGranularity = granularity === "sentence"
      ? candidate.semanticUnit === "sentence"
      : granularity === "paragraph"
        ? candidate.semanticUnit === "paragraph"
        : candidate.source === "ggulnote" && candidate.type === "text";
    if (!matchesGranularity) continue;
    const sourceId = candidate.semanticObjectId ?? candidate.sourceObjectId;
    if (sourceId === undefined) continue;
    const current = result.get(sourceId) ?? [];
    current.push(candidate);
    result.set(sourceId, current);
  }
  return result;
}

function withDiagnostics(
  kind: TargetQuery["kind"],
  result: TargetResolutionResult,
  semantic: SemanticEvidenceResult = emptySemanticEvidence(),
): TargetResolutionResult {
  const evidence = result.status === "RESOLVED"
    ? result.evidence
    : result.status === "AMBIGUOUS"
      ? result.candidates[0]?.evidence
      : undefined;
  const diagnostics: TargetResolutionDiagnostics = {
    targetStrategy: kind,
    evidenceUsed: evidenceUsage(evidence),
    embeddingUsed: semantic.used,
    embeddingCandidateCount: semantic.candidateCount,
    ...(semantic.topScore === undefined ? {} : { topSemanticScore: semantic.topScore }),
    ...(semantic.topMargin === undefined ? {} : { topSemanticMargin: semantic.topMargin }),
    ...(semantic.queryEmbeddingMs === undefined
      ? {}
      : { queryEmbeddingMs: semantic.queryEmbeddingMs }),
    ...(semantic.searchMs === undefined ? {} : { embeddingSearchMs: semantic.searchMs }),
    ...(semantic.errorCode === undefined ? {} : { embeddingErrorCode: semantic.errorCode }),
  };
  return { ...result, diagnostics } as TargetResolutionResult;
}

function evidenceUsage(evidence: CandidateEvidence | undefined): TargetEvidenceUsage {
  return {
    type: evidence?.typeMatch !== null && evidence?.typeMatch !== undefined,
    lexical: evidence?.lexicalMatch !== null && evidence?.lexicalMatch !== undefined,
    fuzzy: evidence?.fuzzyMatch !== null && evidence?.fuzzyMatch !== undefined,
    embedding: evidence?.semanticMatch !== null && evidence?.semanticMatch !== undefined,
    structure: evidence?.structuralMatch !== null && evidence?.structuralMatch !== undefined,
    focus: evidence?.focusMatch !== null && evidence?.focusMatch !== undefined,
    temporal: evidence?.temporalMatch !== null && evidence?.temporalMatch !== undefined,
  };
}

function stripDiagnostics(result: TargetResolutionResult): TargetResolutionResult {
  const { diagnostics: _diagnostics, ...rest } = result;
  return rest as TargetResolutionResult;
}

function emptySemanticEvidence(): SemanticEvidenceResult {
  return { matches: new Map(), used: false, candidateCount: 0 };
}

function unsupported(kind: TargetQuery["kind"]): TargetResolutionResult {
  return withDiagnostics(kind, {
    status: "NOT_FOUND",
    reasonCode: "TARGET_KIND_UNSUPPORTED",
  });
}

function normalizeCosineScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function embeddingErrorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof DOMException && error.name === "AbortError"
    ? "ABORTED"
    : "EMBEDDING_UNAVAILABLE";
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

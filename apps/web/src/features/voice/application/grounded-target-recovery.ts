import type { Rect } from "@ggulnote/editor-core";
import {
  DirectAiProviderError,
  TARGET_RECOVERY_LIMITS,
  type CandidateEvidence,
  type DirectCommandContext,
  type ExecutableDirectPlan,
  type GroundedTargetRecoveryCandidate,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryKind,
  type GroundedTextAnchorCandidate,
  type PageTargetCandidate,
  type RankedTargetCandidate,
  type SpeechGroundingEvidence,
  type TargetRecoveryErrorCode,
  type TargetRecoverySpeechEvidence,
  type TargetResolutionInput,
  type TargetResolutionResult,
} from "../domain";
import type { GroundedTargetRecoveryProvider } from "../providers";
import {
  buildCanonicalTextStream,
  materializeCanonicalTextRange,
  type CanonicalTextStream,
  type CanonicalTextToken,
} from "./canonical-text-stream";
import {
  compactGroundingText,
  fuzzyTextSimilarity,
  normalizeGroundingText,
  rankTargetCandidates,
} from "./candidate-ranker";
import { FrozenTargetResolver } from "./frozen-target-resolver";

type NotFoundResolution = Extract<TargetResolutionResult, { status: "NOT_FOUND" }>;
type ResolvedResolution = Extract<TargetResolutionResult, { status: "RESOLVED" }>;

export interface GroundedTargetRecoveryRequest {
  context: DirectCommandContext;
  plan: ExecutableDirectPlan;
  resolutionInput: TargetResolutionInput;
  initialResolution: NotFoundResolution;
}

export interface GroundedTargetRecoveryOptions {
  signal?: AbortSignal;
}

export type GroundedTargetRecoveryAttempt =
  | {
      status: "RESOLVED";
      kind: GroundedTargetRecoveryKind;
      candidateCount: number;
      providerCalled: true;
      resolution: ResolvedResolution;
    }
  | {
      status: "NONE" | "INVALID";
      kind: GroundedTargetRecoveryKind;
      candidateCount: number;
      providerCalled: boolean;
    }
  | {
      status: "ERROR";
      kind: GroundedTargetRecoveryKind;
      candidateCount: number;
      providerCalled: true;
      errorCode: TargetRecoveryErrorCode;
    };

export interface GroundedTargetRecoveryPort {
  recover(
    request: GroundedTargetRecoveryRequest,
    options?: GroundedTargetRecoveryOptions,
  ): Promise<GroundedTargetRecoveryAttempt>;
}

export interface GroundedTargetRecoveryServiceOptions {
  provider: GroundedTargetRecoveryProvider;
  resolver: FrozenTargetResolver;
}

export class GroundedTargetRecovery implements GroundedTargetRecoveryPort {
  public constructor(private readonly options: GroundedTargetRecoveryServiceOptions) {}

  public async recover(
    request: GroundedTargetRecoveryRequest,
    options: GroundedTargetRecoveryOptions = {},
  ): Promise<GroundedTargetRecoveryAttempt> {
    const query = request.resolutionInput.query;
    switch (query.kind) {
      case "semantic_unit":
        return this.recoverCatalogCandidate(
          request,
          "semantic_unit",
          "C",
          TARGET_RECOVERY_LIMITS.semanticCandidates,
          (candidate) =>
            candidate.semanticUnit === query.unit,
          options.signal,
        );
      case "object":
        return this.recoverCatalogCandidate(
          request,
          "object",
          "O",
          TARGET_RECOVERY_LIMITS.objectCandidates,
          (candidate) =>
            candidate.type === query.objectType,
          options.signal,
        );
      case "text_span":
        return this.recoverTextSpan(request, options.signal);
      case "relative":
      case "subrange":
        return {
          status: "NONE",
          kind: request.resolutionInput.query.kind === "relative"
            ? "object"
            : "text_span",
          candidateCount: 0,
          providerCalled: false,
        };
    }
  }

  private async recoverCatalogCandidate(
    request: GroundedTargetRecoveryRequest,
    kind: "semantic_unit" | "object",
    labelPrefix: "C" | "O",
    limit: number,
    matches: (candidate: PageTargetCandidate) => boolean,
    signal?: AbortSignal,
  ): Promise<GroundedTargetRecoveryAttempt> {
    const eligible = request.resolutionInput.catalog.candidates.filter(
      (candidate) =>
        candidate.pageId === request.resolutionInput.frozenContext.pageId
        && matches(candidate),
    );
    const ranked = rankTargetCandidates(request.resolutionInput)
      .filter((entry) => matches(entry.candidate));
    const bounded = buildBroadCandidatePool(
      eligible,
      ranked,
      request.initialResolution.recoveryCandidates ?? [],
      request.resolutionInput.frozenContext.focusObjectId,
      limit,
    );
    if (bounded.length === 0) {
      return { status: "NONE", kind, candidateCount: 0, providerCalled: false };
    }

    const rankedByCandidateId = new Map(
      ranked.map((entry) => [entry.candidate.candidateId, entry] as const),
    );
    const byLabel = new Map<string, RankedTargetCandidate>();
    const candidates: GroundedTargetRecoveryCandidate[] = bounded.map(
      (candidate, index) => {
        const label = `${labelPrefix}${index + 1}`;
        byLabel.set(
          label,
          rankedByCandidateId.get(candidate.candidateId)
            ?? fallbackRankedCandidate(candidate),
        );
        return toSafeCandidate(label, candidate);
      },
    );
    const input: GroundedTargetRecoveryInput = {
      ...recoveryInputBase(request),
      kind,
      targetQuery: request.resolutionInput.query as
        | Extract<TargetResolutionInput["query"], { kind: "semantic_unit" }>
        | Extract<TargetResolutionInput["query"], { kind: "object" }>,
      candidates,
    } as GroundedTargetRecoveryInput;
    const result = await this.callProvider(input, signal, kind, candidates.length);
    if (result.status === "ERROR") return result;
    if (result.status === "NONE") {
      return {
        status: "NONE",
        kind,
        candidateCount: candidates.length,
        providerCalled: true,
      };
    }
    if (!("candidateLabel" in result)) {
      return {
        status: "INVALID",
        kind,
        candidateCount: candidates.length,
        providerCalled: true,
      };
    }
    const selected = byLabel.get(result.candidateLabel);
    if (selected === undefined) {
      return {
        status: "INVALID",
        kind,
        candidateCount: candidates.length,
        providerCalled: true,
      };
    }
    const resolution = this.options.resolver.resolveRankedCandidate(
      request.resolutionInput,
      {
        ...selected,
        score: Math.max(selected.score, 0.75),
      },
    );
    return resolution.status === "RESOLVED"
      ? {
          status: "RESOLVED",
          kind,
          candidateCount: candidates.length,
          providerCalled: true,
          resolution,
        }
      : {
          status: "INVALID",
          kind,
          candidateCount: candidates.length,
          providerCalled: true,
        };
  }

  private async recoverTextSpan(
    request: GroundedTargetRecoveryRequest,
    signal?: AbortSignal,
  ): Promise<GroundedTargetRecoveryAttempt> {
    const query = request.resolutionInput.query;
    if (
      query.kind !== "text_span"
      || query.startAnchor === undefined
      || query.endAnchor === undefined
    ) {
      return {
        status: "NONE",
        kind: "text_span",
        candidateCount: 0,
        providerCalled: false,
      };
    }
    const canonical = buildRecoveryCanonicalStream(request.resolutionInput);
    if (canonical === undefined) {
      return {
        status: "NONE",
        kind: "text_span",
        candidateCount: 0,
        providerCalled: false,
      };
    }
    const start = buildAnchorCandidates(
      canonical.stream,
      query.startAnchor,
      "A",
      request.context.speechGroundingEvidence,
    );
    const end = buildAnchorCandidates(
      canonical.stream,
      query.endAnchor,
      "B",
      request.context.speechGroundingEvidence,
    );
    const candidateCount = start.safe.length + end.safe.length;
    if (start.safe.length === 0 || end.safe.length === 0) {
      return {
        status: "NONE",
        kind: "text_span",
        candidateCount,
        providerCalled: false,
      };
    }
    const input: GroundedTargetRecoveryInput = {
      ...recoveryInputBase(request),
      kind: "text_span",
      targetQuery: query,
      startCandidates: start.safe,
      endCandidates: end.safe,
    };
    const result = await this.callProvider(
      input,
      signal,
      "text_span",
      candidateCount,
    );
    if (result.status === "ERROR") return result;
    if (result.status === "NONE") {
      return {
        status: "NONE",
        kind: "text_span",
        candidateCount,
        providerCalled: true,
      };
    }
    if (!("startLabel" in result) || !("endLabel" in result)) {
      return {
        status: "INVALID",
        kind: "text_span",
        candidateCount,
        providerCalled: true,
      };
    }
    const startToken = start.byLabel.get(result.startLabel);
    const endToken = end.byLabel.get(result.endLabel);
    if (
      startToken === undefined
      || endToken === undefined
      || startToken.index > endToken.index
      || startToken.token.pageId !== request.resolutionInput.frozenContext.pageId
      || endToken.token.pageId !== request.resolutionInput.frozenContext.pageId
    ) {
      return {
        status: "INVALID",
        kind: "text_span",
        candidateCount,
        providerCalled: true,
      };
    }
    const materialized = materializeCanonicalTextRange(canonical.stream, {
      startIndex: startToken.index,
      endIndex: endToken.index,
    });
    const sourceId = startToken.token.sourceObjectId;
    const sourceCandidate = sourceId === undefined
      ? undefined
      : canonical.sourceCandidates.get(sourceId);
    if (materialized.status !== "RESOLVED" || sourceCandidate === undefined) {
      return {
        status: "INVALID",
        kind: "text_span",
        candidateCount,
        providerCalled: true,
      };
    }
    return {
      status: "RESOLVED",
      kind: "text_span",
      candidateCount,
      providerCalled: true,
      resolution: {
        status: "RESOLVED",
        confidence: 0.75,
        target: {
          candidateId: sourceCandidate.candidateId,
          kind: "text_span",
          pageId: sourceCandidate.pageId,
          sceneRevision: request.resolutionInput.catalog.sceneRevision,
          source: sourceCandidate.source,
          type: sourceCandidate.type,
          editable: sourceCandidate.editable,
          annotatable: sourceCandidate.annotatable,
          ...(sourceCandidate.sceneObjectId === undefined
            ? {}
            : { objectId: sourceCandidate.sceneObjectId }),
          text: materialized.text,
          bounds: [...materialized.bounds],
        },
        evidence: {
          ...emptyEvidence(),
          typeMatch: 1,
        },
      },
    };
  }

  private async callProvider(
    input: GroundedTargetRecoveryInput,
    signal: AbortSignal | undefined,
    kind: GroundedTargetRecoveryKind,
    candidateCount: number,
  ): Promise<
    | Extract<GroundedTargetRecoveryAttempt, { status: "ERROR" }>
    | Awaited<ReturnType<GroundedTargetRecoveryProvider["recover"]>>
  > {
    try {
      return await this.options.provider.recover(
        input,
        signal === undefined ? {} : { signal },
      );
    } catch (error) {
      return {
        status: "ERROR",
        kind,
        candidateCount,
        providerCalled: true,
        errorCode: recoveryErrorCode(error, signal),
      };
    }
  }
}

export function isRecoverableTargetResolution(
  resolutionInput: TargetResolutionInput,
  resolution: NotFoundResolution,
): boolean {
  return (
    resolutionInput.query.kind === "semantic_unit"
    || resolutionInput.query.kind === "text_span"
    || resolutionInput.query.kind === "object"
  ) && (
    resolution.reasonCode === "NO_MATCH"
    || resolution.reasonCode === "LOW_CONFIDENCE"
  );
}

function recoveryInputBase(request: GroundedTargetRecoveryRequest) {
  const evidence = request.context.speechGroundingEvidence;
  return {
    turnId: request.context.turn.id,
    rawFinalTranscript: request.context.turn.rawTranscript,
    normalizedIntent: request.plan.normalizedIntent,
    frozenContext: {
      pageId: request.context.frozenContext.pageId,
      sceneMode: request.context.frozenContext.sceneMode,
      sceneRevision: request.context.frozenContext.sceneRevision,
      focusSource: request.context.frozenContext.focusSource,
    },
    ...(evidence === undefined
      ? {}
      : { speechEvidence: summarizeSpeechEvidence(evidence) }),
  };
}

function summarizeSpeechEvidence(
  evidence: SpeechGroundingEvidence,
): TargetRecoverySpeechEvidence {
  return {
    termHypotheses: evidence.termHypotheses
      .slice(0, TARGET_RECOVERY_LIMITS.termHypotheses)
      .map((term) => ({
        rawSpan: boundText(term.rawSpan, 120),
        candidates: term.candidates
          .slice(0, TARGET_RECOVERY_LIMITS.hypothesisCandidates)
          .map((candidate) => boundText(candidate.value, 120)),
      })),
    numberHypotheses: evidence.numberHypotheses.map((number) => ({
      raw: boundText(number.raw, 120),
      kind: number.kind,
      normalized: normalizeNumberEvidence(number),
    })),
    ...(evidence.mathHypothesis === undefined
      ? {}
      : {
          mathHypothesis: {
            status: evidence.mathHypothesis.status,
            ...(evidence.mathHypothesis.normalizedText === undefined
              ? {}
              : {
                  normalizedText: boundText(
                    evidence.mathHypothesis.normalizedText,
                    160,
                  ),
                }),
          },
        }),
    contextualTerms: evidence.contextualTerms
      .slice(0, TARGET_RECOVERY_LIMITS.contextualTerms)
      .map((term) => boundText(term.text, 120)),
    asrAlternatives: evidence.asrAlternatives
      .slice(0, TARGET_RECOVERY_LIMITS.asrAlternatives)
      .map((alternative) => boundText(alternative.text, 160)),
  };
}

function normalizeNumberEvidence(
  number: SpeechGroundingEvidence["numberHypotheses"][number],
): string {
  switch (number.kind) {
    case "integer":
    case "decimal":
    case "percent":
      return String(number.value);
    case "sequence":
      return number.values.join(",");
    case "power":
      return `${number.base}^${number.exponent}`;
  }
}

function buildBroadCandidatePool(
  eligible: readonly PageTargetCandidate[],
  ranked: readonly RankedTargetCandidate[],
  initialRanked: readonly RankedTargetCandidate[],
  focusObjectId: string | undefined,
  limit: number,
): readonly PageTargetCandidate[] {
  const result: PageTargetCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: PageTargetCandidate | undefined) => {
    if (candidate === undefined || seen.has(candidate.candidateId) || result.length >= limit) {
      return;
    }
    seen.add(candidate.candidateId);
    result.push(candidate);
  };
  initialRanked.forEach((entry) => add(entry.candidate));
  ranked.slice(0, Math.ceil(limit / 2)).forEach((entry) => add(entry.candidate));
  add(eligible.find((candidate) => candidate.sceneObjectId === focusObjectId));

  const readingOrder = [...eligible].sort((left, right) =>
    (left.readingOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.readingOrder ?? Number.MAX_SAFE_INTEGER)
    || left.candidateId.localeCompare(right.candidateId));
  const remaining = limit - result.length;
  if (remaining > 0 && readingOrder.length > 0) {
    for (let index = 0; index < remaining; index += 1) {
      const position = remaining === 1
        ? 0
        : Math.round(index * (readingOrder.length - 1) / (remaining - 1));
      add(readingOrder[position]);
    }
  }
  readingOrder.forEach(add);
  return result;
}

function toSafeCandidate(
  label: string,
  candidate: PageTargetCandidate,
): GroundedTargetRecoveryCandidate {
  return {
    label,
    source: candidate.source,
    type: candidate.type,
    ...(candidate.text === undefined
      ? {}
      : { text: boundText(candidate.text, TARGET_RECOVERY_LIMITS.candidateTextChars) }),
    ...(candidate.semanticUnit === undefined
      ? {}
      : { semanticUnit: candidate.semanticUnit }),
  };
}

function fallbackRankedCandidate(
  candidate: PageTargetCandidate,
): RankedTargetCandidate {
  return {
    candidate,
    score: 0,
    evidence: { ...emptyEvidence(), typeMatch: 1 },
  };
}

function buildRecoveryCanonicalStream(
  input: TargetResolutionInput,
): {
  stream: CanonicalTextStream;
  sourceCandidates: ReadonlyMap<string, PageTargetCandidate>;
} | undefined {
  const semanticModel = input.catalog.semanticModel;
  if (semanticModel === undefined) return undefined;
  const boundsBySourceObjectId = new Map<string, Rect>();
  const sourceCandidates = new Map<string, PageTargetCandidate>();
  for (const candidate of input.catalog.candidates) {
    if (
      candidate.source !== "pdf"
      || candidate.pageId !== input.frozenContext.pageId
      || candidate.sourceObjectId === undefined
      || candidate.bounds === undefined
    ) continue;
    boundsBySourceObjectId.set(candidate.sourceObjectId, { ...candidate.bounds });
    sourceCandidates.set(candidate.sourceObjectId, candidate);
  }
  if (boundsBySourceObjectId.size === 0) return undefined;
  return {
    stream: buildCanonicalTextStream({
      semanticModel,
      pageId: input.frozenContext.pageId,
      boundsBySourceObjectId,
    }),
    sourceCandidates,
  };
}

function buildAnchorCandidates(
  stream: CanonicalTextStream,
  rawAnchor: string,
  prefix: "A" | "B",
  evidence: SpeechGroundingEvidence | undefined,
): {
  safe: readonly GroundedTextAnchorCandidate[];
  byLabel: ReadonlyMap<string, { token: CanonicalTextToken; index: number }>;
} {
  const hypotheses = matchingHypothesisValues(rawAnchor, evidence);
  const normalizedAnchor = compactGroundingText(normalizeGroundingText(rawAnchor));
  const scored = stream.tokens.flatMap((token, index) => {
    const normalizedToken = compactGroundingText(normalizeGroundingText(token.text));
    const hypothesisMatch = hypotheses.has(normalizedToken);
    const exact = normalizedToken.length > 0 && normalizedToken === normalizedAnchor;
    const fuzzy = fuzzyTextSimilarity(token.text, rawAnchor);
    const score = exact || hypothesisMatch ? 1 : fuzzy;
    return score >= 0.55 ? [{ token, index, score }] : [];
  }).sort((left, right) =>
    right.score - left.score
    || left.token.readingOrder - right.token.readingOrder
    || left.token.id.localeCompare(right.token.id))
    .slice(0, TARGET_RECOVERY_LIMITS.anchorCandidatesPerSide);
  const byLabel = new Map<string, { token: CanonicalTextToken; index: number }>();
  const safe = scored.map((entry, index) => {
    const label = `${prefix}${index + 1}`;
    byLabel.set(label, { token: entry.token, index: entry.index });
    return {
      label,
      text: boundText(entry.token.text, 120),
      context: boundText(
        stream.tokens
          .slice(Math.max(0, entry.index - 4), entry.index + 5)
          .map((token) => token.text)
          .join(" "),
        TARGET_RECOVERY_LIMITS.anchorContextChars,
      ),
    };
  });
  return { safe, byLabel };
}

function matchingHypothesisValues(
  rawAnchor: string,
  evidence: SpeechGroundingEvidence | undefined,
): ReadonlySet<string> {
  const anchor = compactGroundingText(normalizeGroundingText(rawAnchor));
  const values = new Set<string>();
  for (const hypothesis of evidence?.termHypotheses ?? []) {
    const raw = compactGroundingText(normalizeGroundingText(hypothesis.rawSpan));
    if (raw.length === 0 || (!anchor.includes(raw) && !raw.includes(anchor))) continue;
    for (const candidate of hypothesis.candidates) {
      values.add(compactGroundingText(normalizeGroundingText(candidate.value)));
    }
  }
  return values;
}

function recoveryErrorCode(
  error: unknown,
  signal: AbortSignal | undefined,
): TargetRecoveryErrorCode {
  if (signal?.aborted) return "RECOVERY_ABORTED";
  if (error instanceof DirectAiProviderError) {
    if (error.code === "ABORTED") return "RECOVERY_ABORTED";
    if (error.code === "PLANNER_TIMEOUT") return "RECOVERY_TIMEOUT";
    if (error.code === "PLANNER_INVALID_OUTPUT") return "RECOVERY_INVALID_OUTPUT";
  }
  return "RECOVERY_UNAVAILABLE";
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

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

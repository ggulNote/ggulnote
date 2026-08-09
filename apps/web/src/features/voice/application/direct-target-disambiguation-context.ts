import type {
  DirectCommandContext,
  DirectTargetDisambiguationInput,
  DirectTargetCandidateLabel,
  ExecutableDirectPlan,
  RankedTargetCandidate,
  TargetQuery,
} from "../domain";
import { DIRECT_TARGET_CANDIDATE_LABELS } from "../domain";

const MAX_CANDIDATE_TEXT_CHARS = 800;

export interface DirectTargetDisambiguationContext {
  input: DirectTargetDisambiguationInput;
  candidatesByLabel: ReadonlyMap<DirectTargetCandidateLabel, RankedTargetCandidate>;
}

export function buildDirectTargetDisambiguationContext(
  context: DirectCommandContext,
  plan: ExecutableDirectPlan,
  query: TargetQuery,
  candidates: readonly RankedTargetCandidate[],
): DirectTargetDisambiguationContext {
  const boundedCandidates = candidates.slice(0, DIRECT_TARGET_CANDIDATE_LABELS.length);
  if (boundedCandidates.length === 0) {
    throw new RangeError("Disambiguation requires at least one candidate.");
  }
  const candidatesByLabel = new Map<
    DirectTargetCandidateLabel,
    RankedTargetCandidate
  >();
  const safeCandidates = boundedCandidates.map((ranked, index) => {
    const label = DIRECT_TARGET_CANDIDATE_LABELS[index];
    candidatesByLabel.set(label, ranked);
    const candidate = ranked.candidate;
    return {
      label,
      source: candidate.source,
      type: candidate.type,
      ...(candidate.text === undefined
        ? {}
        : { text: boundText(candidate.text, MAX_CANDIDATE_TEXT_CHARS) }),
      ...(candidate.semanticUnit === undefined
        ? {}
        : { semanticUnit: candidate.semanticUnit }),
    };
  });

  return {
    input: {
      turnId: context.turn.id,
      rawFinalTranscript: context.turn.rawTranscript,
      normalizedIntent: plan.normalizedIntent,
      targetQuery: query,
      frozenContext: {
        pageId: context.frozenContext.pageId,
        sceneMode: context.frozenContext.sceneMode,
        sceneRevision: context.frozenContext.sceneRevision,
        focusSource: context.frozenContext.focusSource,
      },
      candidates: safeCandidates,
    },
    candidatesByLabel,
  };
}

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

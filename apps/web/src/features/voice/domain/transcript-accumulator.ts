import type { SpeechProviderEvent } from "./speech-types";
import type {
  TranscriptAccumulatorSnapshot,
  VoiceTranscriptSegment,
} from "./voice-turn-types";

export type SpeechTranscriptEvent = Extract<
  SpeechProviderEvent,
  { type: "transcript" }
>;

interface AccumulatedTranscriptSegment extends VoiceTranscriptSegment {
  final: boolean;
}

export class TranscriptAccumulator {
  private readonly segments = new Map<string, AccumulatedTranscriptSegment>();

  public constructor(private providerSessionId: string) {}

  public update(event: SpeechTranscriptEvent): TranscriptAccumulatorSnapshot {
    if (event.sessionId !== this.providerSessionId) {
      return this.getSnapshot();
    }

    const existing = this.segments.get(event.segmentId);
    if (existing?.final) {
      return this.getSnapshot();
    }

    const text = normalizeVoiceTranscriptSegmentText(event.text);
    if (!text) {
      this.segments.delete(event.segmentId);
      return this.getSnapshot();
    }

    const segment: AccumulatedTranscriptSegment = {
      id: event.segmentId,
      index: event.segmentIndex,
      text,
      final: event.isFinal,
    };
    if (event.confidence !== undefined && Number.isFinite(event.confidence)) {
      segment.confidence = event.confidence;
    }

    this.segments.set(event.segmentId, segment);
    return this.getSnapshot();
  }

  public reset(providerSessionId: string): TranscriptAccumulatorSnapshot {
    this.providerSessionId = providerSessionId;
    this.segments.clear();
    return this.getSnapshot();
  }

  public getSnapshot(): TranscriptAccumulatorSnapshot {
    const ordered = [...this.segments.values()].sort(compareSegments);
    const finalSegments = ordered
      .filter((segment) => segment.final)
      .map(toPublicSegment);
    const interimSegments = ordered.filter((segment) => !segment.final);
    const finalText = joinVoiceTranscriptText(finalSegments.map((segment) => segment.text));
    const interimText = joinVoiceTranscriptText(
      interimSegments.map((segment) => segment.text),
    );

    return {
      finalText,
      interimText,
      displayText: joinVoiceTranscriptText([finalText, interimText]),
      finalSegments,
    };
  }
}

export function normalizeVoiceTranscriptSegmentText(text: string): string {
  return text.trim();
}

export function joinVoiceTranscriptText(parts: readonly string[]): string {
  return parts
    .map(normalizeVoiceTranscriptSegmentText)
    .filter((part) => part.length > 0)
    .join(" ");
}

function compareSegments(
  left: AccumulatedTranscriptSegment,
  right: AccumulatedTranscriptSegment,
): number {
  return left.index - right.index || left.id.localeCompare(right.id);
}

function toPublicSegment(
  segment: AccumulatedTranscriptSegment,
): VoiceTranscriptSegment {
  const value: VoiceTranscriptSegment = {
    id: segment.id,
    index: segment.index,
    text: segment.text,
  };
  if (segment.confidence !== undefined) {
    value.confidence = segment.confidence;
  }
  return value;
}

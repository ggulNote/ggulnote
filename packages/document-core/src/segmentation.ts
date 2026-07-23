export interface SentenceSegment {
  start: number;
  end: number;
  text: string;
}

export interface SentenceSegmenter {
  segment(text: string): SentenceSegment[];
}

export class IntlSentenceSegmenter implements SentenceSegmenter {
  public segment(text: string): SentenceSegment[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const local = typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "sentence" })
      : null;

    if (!local) {
      return [];
    }

    const segments: SentenceSegment[] = [];
    for (const item of local.segment(text)) {
      segments.push({
        start: item.index,
        end: item.index + item.segment.length,
        text: item.segment,
      });
    }

    return segments;
  }
}

const FALLBACK_SENTENCE_END_MARKS = new Set([".", "!", "?", "。", "！", "？"]);
const FALLBACK_SENTENCE_TRAIL = new Set(["\"", "\u201D", "\u2019", ")", "]", "}"]);

export class FallbackSentenceSegmenter implements SentenceSegmenter {
  public segment(text: string): SentenceSegment[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const segments: SentenceSegment[] = [];
    let segmentStart = 0;
    let cursor = 0;

    while (cursor < text.length) {
      const char = text.charAt(cursor);
      if (!FALLBACK_SENTENCE_END_MARKS.has(char)) {
        cursor += 1;
        continue;
      }

      let next = cursor + 1;
      while (next < text.length && FALLBACK_SENTENCE_TRAIL.has(text.charAt(next))) {
        next += 1;
      }

      const sentence = text.slice(segmentStart, next).trim();
      if (sentence.length > 0) {
        segments.push({
          start: segmentStart,
          end: next,
          text: sentence,
        });
      }

      segmentStart = next;
      cursor = next;
    }

    if (segmentStart < text.length) {
      const tail = text.slice(segmentStart).trim();
      if (tail.length > 0) {
        segments.push({
          start: segmentStart,
          end: text.length,
          text: tail,
        });
      }
    }

    return segments;
  }
}

export const createSentenceSegmenter = (): SentenceSegmenter => {
  try {
    const segmenter = new IntlSentenceSegmenter();
    const sample = segmenter.segment("안녕하세요. 반갑습니다.");
    if (sample.length >= 1) {
      return segmenter;
    }
  } catch {
    // Intl.Segmenter not available
  }

  return new FallbackSentenceSegmenter();
}

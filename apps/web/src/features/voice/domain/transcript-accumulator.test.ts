import { describe, expect, it } from "vitest";
import type { SpeechTranscriptEvent } from "./transcript-accumulator";
import {
  TranscriptAccumulator,
  joinVoiceTranscriptText,
} from "./transcript-accumulator";

function transcriptEvent(
  sessionId: string,
  segmentIndex: number,
  text: string,
  isFinal: boolean,
  segmentId = `speech:${sessionId}:result:${segmentIndex}`,
): SpeechTranscriptEvent {
  return {
    type: "transcript",
    at: 0,
    sessionId,
    segmentId,
    segmentIndex,
    text,
    isFinal,
  };
}

describe("TranscriptAccumulator", () => {
  it("replaces an interim segment with the same stable id", () => {
    const accumulator = new TranscriptAccumulator("session-1");

    accumulator.update(transcriptEvent("session-1", 0, "이 문단에", false));
    const snapshot = accumulator.update(
      transcriptEvent("session-1", 0, "이 문단에 밑줄", false),
    );

    expect(snapshot).toEqual({
      finalText: "",
      interimText: "이 문단에 밑줄",
      displayText: "이 문단에 밑줄",
      finalSegments: [],
    });
  });

  it("locks a final segment against duplicate final and interim regression", () => {
    const accumulator = new TranscriptAccumulator("session-1");

    accumulator.update(transcriptEvent("session-1", 0, "임시", false));
    accumulator.update(transcriptEvent("session-1", 0, "최종", true));
    accumulator.update(transcriptEvent("session-1", 0, "중복 최종", true));
    const snapshot = accumulator.update(
      transcriptEvent("session-1", 0, "되돌아온 임시", false),
    );

    expect(snapshot.finalText).toBe("최종");
    expect(snapshot.interimText).toBe("");
    expect(snapshot.finalSegments).toEqual([
      {
        id: "speech:session-1:result:0",
        index: 0,
        text: "최종",
      },
    ]);
  });

  it("orders final and interim segments deterministically by result index", () => {
    const accumulator = new TranscriptAccumulator("session-1");

    accumulator.update(transcriptEvent("session-1", 2, "셋", true));
    accumulator.update(transcriptEvent("session-1", 0, "하나", true));
    accumulator.update(transcriptEvent("session-1", 3, "넷", false));
    const snapshot = accumulator.update(
      transcriptEvent("session-1", 1, "둘", true),
    );

    expect(snapshot.finalText).toBe("하나 둘 셋");
    expect(snapshot.interimText).toBe("넷");
    expect(snapshot.displayText).toBe("하나 둘 셋 넷");
    expect(snapshot.finalSegments.map((segment) => segment.index)).toEqual([0, 1, 2]);
  });

  it("trims segment edges, joins with one boundary space, and removes empty interim", () => {
    const accumulator = new TranscriptAccumulator("session-1");

    accumulator.update(transcriptEvent("session-1", 0, "  안쪽  공백  ", true));
    accumulator.update(transcriptEvent("session-1", 1, " 임시 ", false));
    const snapshot = accumulator.update(
      transcriptEvent("session-1", 1, "   ", false),
    );

    expect(snapshot.finalText).toBe("안쪽  공백");
    expect(snapshot.interimText).toBe("");
    expect(joinVoiceTranscriptText([" 하나 ", "", " 둘 "])).toBe("하나 둘");
  });

  it("ignores late events from a previous provider session", () => {
    const accumulator = new TranscriptAccumulator("session-2");

    accumulator.update(transcriptEvent("session-1", 0, "늦은 결과", true));
    const snapshot = accumulator.update(
      transcriptEvent("session-2", 0, "현재 결과", false),
    );

    expect(snapshot.displayText).toBe("현재 결과");
    expect(snapshot.finalSegments).toEqual([]);
  });

  it("clears prior turn data when reset to the next provider session", () => {
    const accumulator = new TranscriptAccumulator("session-1");
    accumulator.update(transcriptEvent("session-1", 0, "첫 턴", true));

    expect(accumulator.reset("session-2")).toEqual({
      finalText: "",
      interimText: "",
      displayText: "",
      finalSegments: [],
    });
    expect(
      accumulator.update(transcriptEvent("session-2", 0, "두 번째 턴", true)).finalText,
    ).toBe("두 번째 턴");
  });

  it("returns snapshots that cannot mutate internal segment state", () => {
    const accumulator = new TranscriptAccumulator("session-1");
    const snapshot = accumulator.update(
      transcriptEvent("session-1", 0, "원본", true),
    );

    snapshot.finalSegments[0].text = "외부 변경";

    expect(accumulator.getSnapshot().finalText).toBe("원본");
  });
});

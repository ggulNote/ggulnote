import { describe, expect, it } from "vitest";
import type {
  CompletedVoiceTurn,
  SpeechRefinementInput,
  SpeechRefinementProviderResult,
} from "../domain";
import type { SpeechRefinerProvider } from "../providers";
import { BoundedSpeechRefiner } from "./bounded-speech-refiner";

class StubRefiner implements SpeechRefinerProvider {
  public calls: SpeechRefinementInput[] = [];

  public constructor(
    private readonly result: SpeechRefinementProviderResult | Error,
  ) {}

  public async refine(
    input: SpeechRefinementInput,
  ): Promise<SpeechRefinementProviderResult> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function turn(rawTranscript: string): CompletedVoiceTurn {
  return {
    id: "turn-1",
    providerId: "test",
    providerSessionId: "session",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript,
    finalSegments: [],
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 1,
      focusSource: "page",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "page",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 1,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 1,
      pageIdAtSpeechStart: "page-1",
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: {
      interimUpdateCount: 0,
      finalSegmentCount: 0,
      providerRestartCount: 0,
    },
  };
}

const allowedCommands = ["annotation.highlight"] as const;

describe("BoundedSpeechRefiner", () => {
  it("cleans self-correction once while preserving raw evidence", async () => {
    const provider = new StubRefiner({
      status: "REFINED",
      refinedTranscript: "챌린지부터 콤플렉스까지 하이라이트 해 줘",
      corrections: [{ kind: "self_correction" }],
    });
    let now = 10;
    const result = await new BoundedSpeechRefiner(
      provider,
      () => now++,
    ).refine({
      turn: turn(
        "어 그 챌린지부터 아니 챌린지부터 콤플렉스까지 하이라이트 해 줘",
      ),
      allowedCommands,
    });

    expect(provider.calls).toHaveLength(1);
    expect(result.rawTranscript).toContain("아니");
    expect(result.refinedTranscript).toBe(
      "챌린지부터 콤플렉스까지 하이라이트 해 줘",
    );
    expect(result).toMatchObject({
      providerCalled: true,
      result: "REFINED",
      changed: true,
      latencyMs: 1,
    });
  });

  it("rejects document-term translation by the Refiner", async () => {
    const provider = new StubRefiner({
      status: "REFINED",
      refinedTranscript: "challenge부터 complex까지 하이라이트",
      corrections: [{ kind: "command_cleanup" }],
    });
    const raw = "어 챌린지부터 콤플렉스까지 하이라이트";
    const result = await new BoundedSpeechRefiner(provider).refine({
      turn: turn(raw),
      allowedCommands,
    });

    expect(result.refinedTranscript).toBe(raw);
    expect(result.result).toBe("REJECTED");
  });

  it("skips the provider on the exact fast path", async () => {
    const provider = new StubRefiner({ status: "UNCHANGED" });
    const result = await new BoundedSpeechRefiner(provider).refine({
      turn: turn("online부터 finish까지 하이라이트"),
      allowedCommands,
    });

    expect(provider.calls).toHaveLength(0);
    expect(result.result).toBe("SKIPPED");
  });

  it("falls back to raw speech after provider failure", async () => {
    const provider = new StubRefiner(new Error("offline"));
    const raw = "어 챌린지부터 콤플렉스까지 하이라이트";
    const result = await new BoundedSpeechRefiner(provider).refine({
      turn: turn(raw),
      allowedCommands,
    });

    expect(result.refinedTranscript).toBe(raw);
    expect(result.result).toBe("ERROR");
  });
});

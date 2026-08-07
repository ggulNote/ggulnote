import type { SpeechProviderAvailability } from "../domain";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import { describe, expect, it, vi } from "vitest";
import { FakeVoiceTurnContextSource } from "./testing/fake-voice-turn-context-source";
import { VoiceTurnController, type VoiceTurnScheduler } from "./voice-turn-controller";

class ManualScheduler implements VoiceTurnScheduler {
  private sequence = 0;
  private readonly callbacks = new Map<number, () => void>();

  public setTimeout(callback: () => void): unknown {
    this.sequence += 1;
    this.callbacks.set(this.sequence, callback);
    return this.sequence;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  public runAll(): void {
    while (this.callbacks.size > 0) {
      const callbacks = [...this.callbacks.values()];
      this.callbacks.clear();
      callbacks.forEach((callback) => callback());
    }
  }

  public get pendingCount(): number {
    return this.callbacks.size;
  }
}

interface VoiceTurnHarnessOptions {
  availability?: SpeechProviderAvailability;
  createTurnId?: () => string;
  createSessionId?: () => string;
}

function createHarness(options: VoiceTurnHarnessOptions = {}) {
  let now = 0;
  let turnSequence = 0;
  let sessionSequence = 0;
  const {
    availability,
    createTurnId = () => {
      turnSequence += 1;
      return `turn-${turnSequence}`;
    },
    createSessionId = () => {
      sessionSequence += 1;
      return `session-${sessionSequence}`;
    },
  } = options;
  const clock = { now: () => toSessionTimeMs(now) };
  const provider = new FakeSpeechRecognitionProvider({
    clock,
    availability,
    createSessionId,
  });
  const context = new FakeVoiceTurnContextSource({
    frozenContext: {
      pageId: "page-3",
      sceneMode: "pdf",
      sceneRevision: 812,
      focusObjectId: "paragraph-12",
      focusBounds: { x: 10, y: 20, width: 100, height: 40 },
      focusSource: "gaze",
      focusStale: false,
      capturedAt: 20,
    },
    focusSnapshot: {
      source: "gaze",
      capturedAt: 20,
      pageId: "page-3",
      sceneRevision: 812,
      objectId: "paragraph-12",
      bounds: { x: 10, y: 20, width: 100, height: 40 },
      stale: false,
    },
  });
  const scheduler = new ManualScheduler();
  const controller = new VoiceTurnController({
    provider,
    contextSource: context,
    clock,
    scheduler,
    createTurnId,
    timing: { speechEndGraceMs: 10, finalResultWaitMs: 20 },
  });
  return {
    controller,
    provider,
    context,
    scheduler,
    setNow: (value: number) => { now = value; },
  };
}

describe("VoiceTurnController", () => {
  it("freezes context once at speech-start and completes with final-only transcript", async () => {
    const harness = createHarness();
    await harness.controller.start();
    expect(harness.controller.getState().status).toBe("starting");
    expect(harness.provider.lastConfig).toMatchObject({ lang: "ko-KR", interimResults: true });

    harness.provider.emitProviderStart({ at: 5 });
    harness.provider.emitAudioStart({ at: 10 });
    expect(harness.context.captureCallCount).toBe(0);
    harness.provider.emitSpeechStart({ at: 20 });
    harness.provider.emitSpeechStart({ at: 21 });
    expect(harness.context.captureCallCount).toBe(1);
    harness.context.setCapture({
      frozenContext: {
        pageId: "page-4",
        sceneMode: "blank",
        sceneRevision: 813,
        focusObjectId: "paragraph-19",
        focusSource: "selection",
        focusStale: false,
        capturedAt: 22,
      },
      focusSnapshot: {
        source: "selection",
        capturedAt: 22,
        pageId: "page-4",
        sceneRevision: 813,
        objectId: "paragraph-19",
        stale: false,
      },
    });

    harness.provider.emitInterim(0, "여기 밑줄", { at: 30 });
    expect(harness.controller.getTranscriptSnapshot().interimText).toBe("여기 밑줄");
    harness.provider.emitSpeechEnd({ at: 40 });
    harness.provider.emitFinal(0, "여기 밑줄 아니 밑줄 말고 노란색 하이라이트", { at: 45 });

    harness.context.setCurrentScene({ pageId: "page-4", sceneRevision: 813 });
    harness.setNow(50);
    harness.provider.emitProviderEnd({ at: 50 });

    const result = harness.controller.getCompletedTurn();
    expect(result).toMatchObject({
      id: "turn-1",
      providerSessionId: "session-1",
      rawTranscript: "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
      frozenContext: {
        pageId: "page-3",
        sceneRevision: 812,
        focusObjectId: "paragraph-12",
      },
      scene: {
        currentSceneRevisionAtCompletion: 813,
        sceneChangedDuringTurn: true,
        pageChangedDuringTurn: true,
      },
      metrics: {
        requestToRecognitionStartMs: 5,
        speechStartToFirstInterimMs: 10,
        speechStartToFirstFinalMs: 25,
        speechEndToFirstFinalMs: 5,
        speechEndToCompletedMs: 10,
        totalTurnMs: 50,
      },
    });
    expect(result?.rawTranscript).not.toContain("여기 밑줄 여기 밑줄");
    expect(harness.controller.getTranscriptSnapshot().finalText).toBe(
      "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
    );
  });

  it("defensively starts one turn when transcript arrives before speech-start", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitProviderStart({ at: 5 });
    harness.provider.emitInterim(0, "너무 빠른 시작", { at: 10 });
    harness.provider.emitFinal(0, "이전 결과", { at: 12 });
    expect(harness.context.captureCallCount).toBe(1);
    expect(harness.controller.getTranscriptSnapshot().finalText).toBe("이전 결과");

    harness.provider.emitSpeechStart({ at: 20 });
    harness.provider.emitInterim(1, "실제 시작", { at: 21 });
    harness.provider.emitFinal(1, "최종 결과", { at: 22 });
    expect(harness.context.captureCallCount).toBe(1);
    expect(harness.controller.getState().status).toBe("capturing");
    expect(harness.controller.getTranscriptSnapshot().finalText).toBe("이전 결과 최종 결과");
  });

  it("stops normally, accepts late final, and completes only on provider end", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 20 });
    harness.setNow(30);
    harness.controller.stop();
    expect(harness.provider.stopCallCount).toBe(1);
    expect(harness.controller.getState().status).toBe("finalizing");
    expect(harness.controller.getCompletedTurn()).toBeUndefined();
    harness.provider.emitFinal(0, "정상 종료 결과", { at: 35 });
    harness.setNow(40);
    harness.provider.emitProviderEnd({ at: 40, intentional: true });
    expect(harness.controller.getCompletedTurn()?.rawTranscript).toBe("정상 종료 결과");
  });

  it("cancels without producing an executable result and ignores aborted/end events", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 20 });
    harness.provider.emitFinal(0, "취소할 결과", { at: 25 });
    harness.setNow(30);
    harness.controller.cancel();
    expect(harness.provider.abortCallCount).toBe(1);
    expect(harness.controller.getState().status).toBe("cancelled");
    expect(harness.controller.getCompletedTurn()).toBeUndefined();
    harness.provider.emitError({ code: "aborted", recoverable: false, retryPolicy: "none" }, { at: 31 });
    harness.provider.emitProviderEnd({ at: 32, intentional: true });
    expect(harness.controller.getState().status).toBe("cancelled");
  });

  it("marks cancellation before a synchronous aborted callback", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 20 });
    const originalAbort = harness.provider.abort.bind(harness.provider);
    vi.spyOn(harness.provider, "abort").mockImplementationOnce(() => {
      originalAbort();
      harness.provider.emitError(
        { code: "aborted", recoverable: false, retryPolicy: "none" },
        { at: 21 },
      );
    });
    harness.controller.cancel();
    expect(harness.controller.getState().status).toBe("cancelled");
  });

  it("does not create a speech turn after stop was requested before speech", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitProviderStart({ at: 5 });
    harness.controller.stop();
    harness.provider.emitSpeechStart({ at: 10 });
    expect(harness.context.captureCallCount).toBe(0);
    harness.provider.emitProviderEnd({ at: 15, intentional: true });
    expect(harness.controller.getState()).toMatchObject({
      status: "discarded",
      reason: "provider-ended-before-speech",
    });
  });

  it("discards empty turns after provider end or final wait timeout", async () => {
    const ended = createHarness();
    await ended.controller.start();
    ended.provider.emitSpeechStart({ at: 20 });
    ended.provider.emitProviderEnd({ at: 30 });
    expect(ended.controller.getState()).toMatchObject({ status: "discarded", reason: "empty-transcript" });

    const timed = createHarness();
    await timed.controller.start();
    timed.provider.emitSpeechStart({ at: 20 });
    timed.provider.emitSpeechEnd({ at: 30 });
    timed.scheduler.runAll();
    expect(timed.controller.getState()).toMatchObject({ status: "discarded", reason: "empty-transcript" });
  });

  it("normalizes unsupported, provider errors, and context capture failure into terminal states", async () => {
    const unsupported = createHarness({
      availability: {
        supported: false,
        constructorName: "SpeechRecognition",
        local: { supported: false, status: "unavailable" },
        contextualBiasingSupported: false,
      },
    });
    await unsupported.controller.start();
    expect(unsupported.controller.getState().status).toBe("unsupported");

    const failed = createHarness();
    await failed.controller.start();
    failed.provider.emitProviderStart({ at: 5 });
    failed.provider.emitError({ code: "not-allowed", recoverable: false, retryPolicy: "none" }, { at: 6 });
    expect(failed.controller.getState()).toMatchObject({ status: "failed", error: { code: "not-allowed" } });
    failed.provider.emitProviderEnd({ at: 7 });
    expect(failed.controller.getState().status).toBe("failed");

    const contextFailure = createHarness();
    contextFailure.context.setCaptureError(new Error("scene unavailable"));
    await contextFailure.controller.start();
    contextFailure.provider.emitSpeechStart({ at: 20 });
    expect(contextFailure.controller.getState()).toMatchObject({
      status: "failed",
      error: { code: "context-capture-failed", message: "scene unavailable" },
    });
  });

  it.each([
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "no-speech",
    "network",
    "aborted",
    "language-not-supported",
    "unknown",
  ] as const)("keeps normalized %s provider errors", async (code) => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitProviderStart({ at: 5 });
    harness.provider.emitError({ code, recoverable: code === "network", retryPolicy: "none" }, { at: 6 });
    expect(harness.controller.getState()).toMatchObject({ status: "failed", error: { code } });
  });

  it("completes with final transcript and preserves later provider error metadata", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 20 });
    harness.provider.emitFinal(0, "보존할 최종 결과", { at: 25 });
    harness.provider.emitError(
      { code: "network", recoverable: true, retryPolicy: "restart-once" },
      { at: 30 },
    );
    expect(harness.controller.getCompletedTurn()).toMatchObject({
      rawTranscript: "보존할 최종 결과",
      error: { code: "network" },
    });
  });

  it("converts provider start rejection and allows a later retry", async () => {
    const harness = createHarness();
    vi.spyOn(harness.provider, "start").mockRejectedValueOnce(new Error("start failed"));
    await harness.controller.start();
    expect(harness.controller.getState()).toMatchObject({
      status: "failed",
      error: { code: "provider-start-failed", message: "start failed" },
    });
    await harness.controller.start();
    expect(harness.provider.startCallCount).toBe(1);
    expect(harness.controller.getState().status).toBe("starting");
  });

  it("isolates sessions, resets transcripts, and allows a new turn after completion", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 10 });
    harness.provider.emitFinal(0, "첫 번째", { at: 15 });
    harness.setNow(20);
    harness.provider.emitProviderEnd({ at: 20 });

    await harness.controller.start();
    expect(harness.controller.getTranscriptSnapshot().finalText).toBe("");
    harness.provider.emitSpeechStart({ sessionId: "session-1", at: 21 });
    harness.provider.emitFinal(0, "늦은 이전 결과", { sessionId: "session-1", at: 22 });
    expect(harness.context.captureCallCount).toBe(1);
    harness.provider.emitSpeechStart({ at: 30 });
    harness.provider.emitFinal(0, "두 번째", { at: 35 });
    harness.setNow(40);
    harness.provider.emitProviderEnd({ at: 40 });
    expect(harness.controller.getCompletedTurn()?.rawTranscript).toBe("두 번째");
  });

  it("separates turn id and provider session id per session", async () => {
    let turnCounter = 0;
    let sessionCounter = 0;

    const harness = createHarness({
      createTurnId: () => {
        turnCounter += 1;
        return `turn-${turnCounter}`;
      },
      createSessionId: () => {
        sessionCounter += 1;
        return `session-${sessionCounter}`;
      },
    });

    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 10 });
    harness.provider.emitFinal(0, "첫 번째", { at: 15 });
    harness.setNow(20);
    harness.provider.emitProviderEnd({ at: 20 });

    const firstTurn = harness.controller.getCompletedTurn();
    expect(firstTurn?.id).toBe("turn-1");
    expect(firstTurn?.providerSessionId).toBe("session-1");
    expect(firstTurn?.id).not.toBe(firstTurn?.providerSessionId);

    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 21 });
    harness.provider.emitFinal(0, "두 번째", { at: 25 });
    harness.setNow(30);
    harness.provider.emitProviderEnd({ at: 30 });

    const secondTurn = harness.controller.getCompletedTurn();
    expect(secondTurn?.id).toBe("turn-2");
    expect(secondTurn?.providerSessionId).toBe("session-2");
    expect(secondTurn?.id).not.toBe(secondTurn?.providerSessionId);
  });

  it("ignores stale session events after active session has started", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 10 });
    harness.provider.emitFinal(0, "첫 번째", { at: 15 });
    harness.setNow(20);
    harness.provider.emitProviderEnd({ at: 20 });

    await harness.controller.start();
    harness.provider.emitSpeechStart({ sessionId: "session-1", at: 21 });
    harness.provider.emitSpeechStart({ at: 30 });
    harness.provider.emitFinal(0, "늦은 이전 결과", { sessionId: "session-1", at: 35 });
    harness.provider.emitProviderEnd({ sessionId: "session-1", at: 36, intentional: true });
    harness.provider.emitFinal(0, "두 번째", { at: 45 });
    harness.setNow(50);
    harness.provider.emitProviderEnd({ at: 50 });

    expect(harness.controller.getCompletedTurn()?.providerSessionId).toBe("session-2");
    expect(harness.controller.getCompletedTurn()?.rawTranscript).toBe("두 번째");
  });

  it("prevents duplicate start, cleans subscriptions, and disposes idempotently", async () => {
    const harness = createHarness();
    const listener = vi.fn();
    harness.controller.subscribe(listener);
    const firstStart = harness.controller.start();
    await harness.controller.start();
    await firstStart;
    expect(harness.provider.startCallCount).toBe(1);
    harness.controller.dispose();
    harness.controller.dispose();
    harness.provider.emit({ type: "provider-start", sessionId: "late", at: 1 });
    expect(harness.provider.abortCallCount).toBe(1);
  });

  it("clears pending finalization timers on dispose", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 20 });
    harness.provider.emitSpeechEnd({ at: 25 });
    expect(harness.scheduler.pendingCount).toBe(1);
    harness.controller.dispose();
    expect(harness.scheduler.pendingCount).toBe(0);
  });
});

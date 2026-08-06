import type {
  VoiceCurrentSceneReference,
  VoiceTurnContextCapture,
  VoiceTurnContextSource,
} from "../voice-turn-context-source";

export class FakeVoiceTurnContextSource implements VoiceTurnContextSource {
  private captureValue: VoiceTurnContextCapture;
  private currentScene: VoiceCurrentSceneReference;
  private captureError: Error | undefined;
  private captureCalls = 0;

  public constructor(capture: VoiceTurnContextCapture) {
    this.captureValue = cloneCapture(capture);
    this.currentScene = {
      pageId: capture.frozenContext.pageId,
      sceneRevision: capture.frozenContext.sceneRevision,
    };
  }

  public capture(_capturedAt: number): VoiceTurnContextCapture {
    this.captureCalls += 1;
    if (this.captureError) throw this.captureError;
    return cloneCapture(this.captureValue);
  }

  public getCurrentSceneReference(): VoiceCurrentSceneReference {
    return { ...this.currentScene };
  }

  public setCapture(capture: VoiceTurnContextCapture): void {
    this.captureValue = cloneCapture(capture);
    this.captureError = undefined;
  }

  public setCurrentScene(value: VoiceCurrentSceneReference): void {
    this.currentScene = { ...value };
  }

  public setCaptureError(error: Error): void {
    this.captureError = error;
  }

  public get captureCallCount(): number {
    return this.captureCalls;
  }
}

function cloneCapture(capture: VoiceTurnContextCapture): VoiceTurnContextCapture {
  return {
    frozenContext: {
      ...capture.frozenContext,
      ...(capture.frozenContext.focusBounds
        ? { focusBounds: { ...capture.frozenContext.focusBounds } }
        : {}),
    },
    focusSnapshot: {
      ...capture.focusSnapshot,
      ...(capture.focusSnapshot.bounds
        ? { bounds: { ...capture.focusSnapshot.bounds } }
        : {}),
    },
  };
}

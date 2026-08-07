import { InteractionClock } from "@ggulnote/interaction-core";
import { VoiceTurnController } from "../application/voice-turn-controller";
import { FakeVoiceTurnContextSource } from "../application/testing/fake-voice-turn-context-source";
import type {
  FrozenVoiceTurnContext,
  VoiceFocusSnapshot,
} from "../domain";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import {
  WebSpeechRecognitionProvider,
  getBrowserWebSpeechGlobalScope,
  type SpeechRecognitionProvider,
} from "../providers";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import { resolveVoiceLensPositionDebug } from "../presentation/voice-lens-position";
import {
  runFakeVoiceScenario,
  type VoiceDebugFakeScenario,
} from "./fake-provider-scenarios";
import { VoiceDebugStore } from "./voice-debug-store";
import type {
  VoiceDebugContextSnapshot,
  VoiceDebugSnapshot,
} from "./voice-debug-types";

export type VoiceDebugProviderKind = "browser" | "fake";

export interface VoiceDebugRuntimeContract {
  readonly providerKind: VoiceDebugProviderKind;
  getSnapshot(): VoiceDebugSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  retry(): Promise<void>;
  runScenario(scenario: VoiceDebugFakeScenario): Promise<void>;
  changeCurrentFocus(): void;
  incrementCurrentScene(): void;
  changeCurrentPage(): void;
  resetCurrentContext(): void;
  clearEvents(): void;
  clearHistory(): void;
  dispose(): void;
}

const INITIAL_CONTEXT: VoiceDebugContextSnapshot = {
  pageId: "page-1",
  sceneMode: "pdf",
  sceneRevision: 812,
  focusSource: "selection",
  focusObjectId: "paragraph-12",
  focusBounds: { x: 130, y: 180, width: 360, height: 96 },
  focusStale: false,
  capturedAt: 0,
};

export class VoiceDebugRuntime implements VoiceDebugRuntimeContract {
  public readonly providerKind: VoiceDebugProviderKind;
  private readonly clock: InteractionClock;
  private readonly provider: SpeechRecognitionProvider;
  private readonly fakeProvider: FakeSpeechRecognitionProvider | undefined;
  private readonly contextSource: FakeVoiceTurnContextSource;
  private readonly store: VoiceDebugStore;
  private readonly controller: VoiceTurnController;
  private readonly unsubscribeController: () => void;
  private readonly handleResize: () => void;
  private currentContext: VoiceDebugContextSnapshot;
  private turnSequence = 0;
  private disposed = false;

  public constructor(providerKind: VoiceDebugProviderKind) {
    this.providerKind = providerKind;
    this.clock = new InteractionClock(readMonotonicTime);
    this.currentContext = cloneContext({
      ...INITIAL_CONTEXT,
      capturedAt: this.clock.now(),
    });
    this.contextSource = new FakeVoiceTurnContextSource(
      createCapture(this.currentContext),
    );
    this.contextSource.setCurrentScene({
      pageId: this.currentContext.pageId,
      sceneRevision: this.currentContext.sceneRevision,
    });

    const scope = getBrowserWebSpeechGlobalScope();
    const api = {
      speechRecognition: typeof scope?.SpeechRecognition === "function",
      webkitSpeechRecognition: typeof scope?.webkitSpeechRecognition === "function",
    };
    if (providerKind === "fake") {
      const fake = new FakeSpeechRecognitionProvider({ clock: this.clock });
      this.fakeProvider = fake;
      this.provider = fake;
    } else {
      this.fakeProvider = undefined;
      this.provider = new WebSpeechRecognitionProvider({ clock: this.clock });
    }

    this.store = new VoiceDebugStore({
      providerId: this.provider.id,
      config: DEFAULT_COMMAND_RECOGNITION_CONFIG,
      api: providerKind === "fake"
        ? { speechRecognition: false, webkitSpeechRecognition: false }
        : api,
      currentContext: this.currentContext,
    });
    this.controller = new VoiceTurnController({
      provider: this.provider,
      contextSource: this.contextSource,
      clock: this.clock,
      createTurnId: () => {
        this.turnSequence += 1;
        return `debug-turn-${this.turnSequence}`;
      },
      diagnostics: this.store.diagnostics,
    });
    this.store.attachController(this.controller);
    this.unsubscribeController = this.controller.subscribe(() => this.refreshLensPosition());
    this.handleResize = () => this.refreshLensPosition();
    globalThis.addEventListener?.("resize", this.handleResize);
    this.refreshLensPosition();
    void this.readAvailability();
  }

  public getSnapshot = (): VoiceDebugSnapshot => this.store.getSnapshot();

  public subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  public async start(): Promise<void> {
    if (this.disposed || isActive(this.controller.getState().status)) return;
    this.prepareCapture();
    await this.controller.start();
  }

  public stop(): void {
    this.controller.stop();
  }

  public cancel(): void {
    this.controller.cancel();
  }

  public async retry(): Promise<void> {
    await this.start();
  }

  public async runScenario(scenario: VoiceDebugFakeScenario): Promise<void> {
    if (!this.fakeProvider || this.disposed || isActive(this.controller.getState().status)) return;
    this.prepareCapture();
    await this.controller.start();
    await runFakeVoiceScenario(this.fakeProvider, scenario, {
      baseAt: this.clock.now(),
      delayMs: 20,
      startProvider: false,
      cancel: () => this.controller.cancel(),
    }).done;
  }

  public changeCurrentFocus(): void {
    const moved = this.currentContext.focusObjectId !== "paragraph-19";
    this.updateCurrentContext({
      ...this.currentContext,
      focusSource: "selection",
      focusObjectId: moved ? "paragraph-19" : "paragraph-12",
      focusBounds: moved
        ? { x: 210, y: 330, width: 420, height: 88 }
        : { x: 130, y: 180, width: 360, height: 96 },
      focusStale: false,
      capturedAt: this.clock.now(),
    });
  }

  public incrementCurrentScene(): void {
    this.updateCurrentContext({
      ...this.currentContext,
      sceneRevision: this.currentContext.sceneRevision + 1,
      capturedAt: this.clock.now(),
    });
  }

  public changeCurrentPage(): void {
    this.updateCurrentContext({
      ...this.currentContext,
      pageId: this.currentContext.pageId === "page-1" ? "page-2" : "page-1",
      capturedAt: this.clock.now(),
    });
  }

  public resetCurrentContext(): void {
    this.updateCurrentContext({
      ...INITIAL_CONTEXT,
      capturedAt: this.clock.now(),
    });
  }

  public clearEvents(): void {
    this.store.clearEvents();
  }

  public clearHistory(): void {
    this.store.clearHistory();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    globalThis.removeEventListener?.("resize", this.handleResize);
    this.unsubscribeController();
    this.controller.dispose();
    this.store.dispose();
  }

  private async readAvailability(): Promise<void> {
    try {
      const availability = await this.provider.getAvailability(
        DEFAULT_COMMAND_RECOGNITION_CONFIG,
      );
      if (!this.disposed) this.store.setAvailability(availability);
    } catch {
      if (!this.disposed) {
        this.store.setAvailability({
          supported: false,
          local: { supported: false, status: "unknown" },
          contextualBiasingSupported: false,
        });
      }
    }
  }

  private prepareCapture(): void {
    this.contextSource.setCapture(createCapture(this.currentContext));
    this.contextSource.setCurrentScene({
      pageId: this.currentContext.pageId,
      sceneRevision: this.currentContext.sceneRevision,
    });
  }

  private updateCurrentContext(context: VoiceDebugContextSnapshot): void {
    this.currentContext = cloneContext(context);
    this.contextSource.setCurrentScene({
      pageId: context.pageId,
      sceneRevision: context.sceneRevision,
    });
    this.store.setCurrentContext(this.currentContext);
    this.refreshLensPosition();
  }

  private refreshLensPosition(): void {
    const frozen = this.controller.getFrozenContext();
    const viewportWidth = readViewportDimension("width");
    const viewportHeight = readViewportDimension("height");
    const pageVisible = frozen?.pageId === this.currentContext.pageId;
    const fallbackReason = !frozen?.focusBounds
      ? "NO_FROZEN_FOCUS" as const
      : frozen.focusStale
        ? "INVALID_BOUNDS" as const
        : !pageVisible
          ? "FROZEN_PAGE_NOT_VISIBLE" as const
          : undefined;
    const metadata = resolveVoiceLensPositionDebug({
      anchorRect: fallbackReason ? undefined : frozen?.focusBounds,
      lensSize: { width: 320, height: 80 },
      safeRect: {
        x: 24,
        y: 88,
        width: Math.max(0, viewportWidth - 48),
        height: Math.max(0, viewportHeight - 112),
      },
      gap: 12,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
    this.store.setLensPosition(metadata);
  }
}

export function createVoiceDebugRuntime(
  providerKind: VoiceDebugProviderKind,
): VoiceDebugRuntimeContract {
  return new VoiceDebugRuntime(providerKind);
}

function createCapture(context: VoiceDebugContextSnapshot): {
  frozenContext: FrozenVoiceTurnContext;
  focusSnapshot: VoiceFocusSnapshot;
} {
  const frozenContext: FrozenVoiceTurnContext = {
    pageId: context.pageId,
    sceneMode: context.sceneMode,
    sceneRevision: context.sceneRevision,
    focusSource: context.focusSource,
    focusStale: context.focusStale,
    capturedAt: context.capturedAt,
  };
  const focusSnapshot: VoiceFocusSnapshot = {
    source: context.focusSource,
    capturedAt: context.capturedAt,
    pageId: context.pageId,
    sceneRevision: context.sceneRevision,
    stale: context.focusStale,
  };
  if (context.focusObjectId) {
    frozenContext.focusObjectId = context.focusObjectId;
    focusSnapshot.objectId = context.focusObjectId;
  }
  if (context.focusBounds) {
    frozenContext.focusBounds = { ...context.focusBounds };
    focusSnapshot.bounds = { ...context.focusBounds };
  }
  return { frozenContext, focusSnapshot };
}

function cloneContext(context: VoiceDebugContextSnapshot): VoiceDebugContextSnapshot {
  return {
    ...context,
    ...(context.focusBounds ? { focusBounds: { ...context.focusBounds } } : {}),
  };
}

function readMonotonicTime(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function readViewportDimension(axis: "width" | "height"): number {
  const value = axis === "width"
    ? globalThis.innerWidth
    : globalThis.innerHeight;
  return Number.isFinite(value) && value > 0
    ? value
    : axis === "width" ? 960 : 640;
}

function isActive(status: string): boolean {
  return status === "starting" || status === "capturing" || status === "finalizing";
}

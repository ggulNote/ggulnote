import type { SpeechProviderError, SpeechProviderErrorCode, SpeechRecognitionConfig } from "../domain";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import type { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";

export type VoiceDebugFakeScenario =
  | "happy-path"
  | "self-correction"
  | "error-permission"
  | "error-no-speech"
  | "error-network"
  | "cancel";

export interface FakeVoiceScenarioOptions {
  config?: SpeechRecognitionConfig;
  baseAt?: number;
  delayMs?: number;
  startProvider?: boolean;
  onStep?: (label: string, at: number) => void;
  cancel?: () => void;
}

export interface FakeVoiceScenarioPlayback {
  stop: () => void;
  done: Promise<void>;
  isRunning: () => boolean;
}

interface FakeScenarioStep {
  offsetMs: number;
  label: string;
  run(
    provider: FakeSpeechRecognitionProvider,
    at: number,
    controls: Pick<FakeVoiceScenarioOptions, "cancel">,
  ): void;
}

const SCENARIO_DEFINITIONS: Record<VoiceDebugFakeScenario, FakeScenarioStep[]> = {
  "happy-path": [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 20, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    {
      offsetMs: 35,
      label: "interim-1",
      run: (provider, at) =>
        provider.emitInterim(0, "여기 밑줄 아니", { at, segmentId: "debug:interim:1" }),
    },
    {
      offsetMs: 70,
      label: "final",
      run: (provider, at) =>
        provider.emitFinal(0, "이 문단에 노란색 하이라이트", { at, segmentId: "debug:final:1" }),
    },
    { offsetMs: 95, label: "speech-end", run: (provider, at) => provider.emitSpeechEnd({ at }) },
    { offsetMs: 105, label: "audio-end", run: (provider, at) => provider.emitAudioEnd({ at }) },
    {
      offsetMs: 115,
      label: "provider-end",
      run: (provider, at) => provider.emitProviderEnd({ at, intentional: false }),
    },
  ],
  "self-correction": [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 20, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    {
      offsetMs: 35,
      label: "interim-1",
      run: (provider, at) => provider.emitInterim(0, "여기 밑줄", { at, segmentId: "debug:self:1" }),
    },
    {
      offsetMs: 55,
      label: "interim-2",
      run: (provider, at) => provider.emitInterim(0, "여기 밑줄 아니", { at, segmentId: "debug:self:1" }),
    },
    {
      offsetMs: 80,
      label: "interim-3",
      run: (provider, at) => provider.emitInterim(0, "여기 밑줄 아니 밑줄 말고", { at, segmentId: "debug:self:1" }),
    },
    {
      offsetMs: 110,
      label: "interim-4",
      run: (provider, at) =>
        provider.emitInterim(0, "여기 밑줄 아니 밑줄 말고 노란색", { at, segmentId: "debug:self:1" }),
    },
    {
      offsetMs: 145,
      label: "final",
      run: (provider, at) =>
        provider.emitFinal(0, "여기 밑줄 아니 밑줄 말고 노란색 하이라이트", {
          at,
          segmentId: "debug:self:1",
        }),
    },
    { offsetMs: 175, label: "speech-end", run: (provider, at) => provider.emitSpeechEnd({ at }) },
    { offsetMs: 190, label: "audio-end", run: (provider, at) => provider.emitAudioEnd({ at }) },
    {
      offsetMs: 200,
      label: "provider-end",
      run: (provider, at) => provider.emitProviderEnd({ at, intentional: false }),
    },
  ],
  "error-permission": [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 25, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    {
      offsetMs: 30,
      label: "error",
      run: (provider, at) =>
        provider.emitError(createDebugSpeechError("not-allowed", "permission denied", false), {
          at,
        }),
    },
    {
      offsetMs: 40,
      label: "provider-end",
      run: (provider, at) => provider.emitProviderEnd({ at, intentional: false }),
    },
  ],
  "error-no-speech": [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 25, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    { offsetMs: 40, label: "speech-end", run: (provider, at) => provider.emitSpeechEnd({ at }) },
    {
      offsetMs: 45,
      label: "error",
      run: (provider, at) =>
        provider.emitError(createDebugSpeechError("no-speech", "no speech detected", true), {
          at,
        }),
    },
    {
      offsetMs: 55,
      label: "provider-end",
      run: (provider, at) => provider.emitProviderEnd({ at, intentional: false }),
    },
  ],
  "error-network": [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 20, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    {
      offsetMs: 30,
      label: "error",
      run: (provider, at) => provider.emitError(createDebugSpeechError("network", "network failure", true), { at }),
    },
    {
      offsetMs: 45,
      label: "provider-end",
      run: (provider, at) => provider.emitProviderEnd({ at, intentional: false }),
    },
  ],
  cancel: [
    { offsetMs: 0, label: "provider-start", run: (provider, at) => provider.emitProviderStart({ at }) },
    { offsetMs: 10, label: "audio-start", run: (provider, at) => provider.emitAudioStart({ at }) },
    { offsetMs: 20, label: "speech-start", run: (provider, at) => provider.emitSpeechStart({ at }) },
    {
      offsetMs: 40,
      label: "interim-1",
      run: (provider, at) =>
        provider.emitInterim(0, "취소될 수 있는 발화", { at, segmentId: "debug:cancel:1" }),
    },
    {
      offsetMs: 60,
      label: "cancel-end",
      run: (provider, at, controls) => {
        if (controls.cancel) controls.cancel();
        else provider.abort();
        provider.emitProviderEnd({ at, intentional: true });
      },
    },
  ],
};

export function runFakeVoiceScenario(
  provider: FakeSpeechRecognitionProvider,
  scenario: VoiceDebugFakeScenario,
  options: FakeVoiceScenarioOptions = {},
): FakeVoiceScenarioPlayback {
  const steps = SCENARIO_DEFINITIONS[scenario];
  const baseAt = options.baseAt ?? 0;
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const config = options.config ?? DEFAULT_COMMAND_RECOGNITION_CONFIG;
  const shouldStartProvider = options.startProvider ?? true;

  let canceled = false;
  let completed = false;
  let pendingSleepResolve: (() => void) | null = null;

  const activeTimers = new Set<ReturnType<typeof setTimeout>>();

  const sleep = async (milliseconds: number): Promise<void> => {
    if (milliseconds <= 0 || canceled) return Promise.resolve();

    return new Promise((resolve) => {
      pendingSleepResolve = () => {
        resolve();
      };
      const timer = globalThis.setTimeout(() => {
        activeTimers.delete(timer);
        pendingSleepResolve = null;
        resolve();
      }, milliseconds);
      activeTimers.add(timer);
    });
  };

  const clearPendingTimeouts = (): void => {
    const timers = [...activeTimers];
    activeTimers.clear();
    for (const timer of timers) {
      clearTimeout(timer);
    }
    if (pendingSleepResolve) {
      const wake = pendingSleepResolve;
      pendingSleepResolve = null;
      wake();
    }
  };

  const handle: FakeVoiceScenarioPlayback = {
    stop: () => {
      canceled = true;
      provider.stop();
      clearPendingTimeouts();
    },
    done: Promise.resolve(),
    isRunning: () => !completed && !canceled,
  };

  handle.done = (async () => {
    try {
      if (shouldStartProvider) {
        await provider.start(config);
      }
      if (canceled) {
        return;
      }

      for (const step of steps) {
        if (canceled) {
          return;
        }

        await sleep(delayMs);

        if (canceled) {
          return;
        }

        const at = baseAt + step.offsetMs;
        options.onStep?.(step.label, at);
      step.run(provider, at, { cancel: options.cancel });
      }
    } finally {
      completed = true;
      clearPendingTimeouts();
    }
  })();

  return handle;
}

function createDebugSpeechError(
  code: SpeechProviderErrorCode,
  message: string,
  recoverable: boolean,
): SpeechProviderError {
  return {
    code,
    message,
    recoverable,
    retryPolicy: recoverable ? "restart-while-mode-active" : "none",
  };
}

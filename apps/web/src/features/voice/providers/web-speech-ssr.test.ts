// @vitest-environment node
import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import { getBrowserWebSpeechGlobalScope } from "./web-speech-compat";
import { WebSpeechRecognitionProvider } from "./web-speech-recognition-provider";

describe("Web Speech SSR safety", () => {
  it("imports and reports unsupported without reading a browser window", async () => {
    const provider = new WebSpeechRecognitionProvider({
      clock: new InteractionClock(() => 100),
    });

    expect(getBrowserWebSpeechGlobalScope()).toBeUndefined();
    await expect(
      provider.getAvailability(DEFAULT_COMMAND_RECOGNITION_CONFIG),
    ).resolves.toMatchObject({ supported: false });
    await expect(
      provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG),
    ).rejects.toMatchObject({ detail: { code: "unsupported" } });
  });

  it("defers browser scope access until provider APIs are called", async () => {
    const getGlobalScope = vi.fn(() => undefined);
    const provider = new WebSpeechRecognitionProvider({
      clock: new InteractionClock(() => 100),
      getGlobalScope,
    });

    expect(getGlobalScope).not.toHaveBeenCalled();

    await expect(
      provider.getAvailability(DEFAULT_COMMAND_RECOGNITION_CONFIG),
    ).resolves.toMatchObject({ supported: false });
    expect(getGlobalScope).toHaveBeenCalledTimes(1);

    await expect(
      provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG),
    ).rejects.toMatchObject({ detail: { code: "unsupported" } });
    expect(getGlobalScope).toHaveBeenCalledTimes(2);
  });
});

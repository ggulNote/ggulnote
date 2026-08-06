import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMAND_RECOGNITION_CONFIG,
  cloneSpeechRecognitionConfig,
} from "./speech-types";

describe("speech domain contracts", () => {
  it("defines the approved Korean command recognition defaults", () => {
    expect(DEFAULT_COMMAND_RECOGNITION_CONFIG).toEqual({
      lang: "ko-KR",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
      mode: "browser-default",
      quality: "command",
      phrases: [],
    });
  });

  it("clones config and nested bias phrases", () => {
    const source = {
      ...DEFAULT_COMMAND_RECOGNITION_CONFIG,
      phrases: [{ text: "하이라이트", boost: 4 }],
    };
    const cloned = cloneSpeechRecognitionConfig(source);

    cloned.phrases[0].text = "밑줄";

    expect(source.phrases[0].text).toBe("하이라이트");
    expect(cloned).not.toBe(source);
    expect(cloned.phrases).not.toBe(source.phrases);
  });
});

import { describe, expect, it } from "vitest";
import {
  SpeechRefinementValidationError,
  parseSpeechRefinementInput,
  parseSpeechRefinementProviderResult,
} from "./speech-refinement-schema";

describe("speech refinement schema", () => {
  it("accepts bounded strict input and output", () => {
    expect(parseSpeechRefinementInput({
      rawTranscript: "어 여기 밑줄",
      language: "ko-KR",
      allowedCommands: ["annotation.underline"],
    })).toEqual({
      rawTranscript: "어 여기 밑줄",
      language: "ko-KR",
      allowedCommands: ["annotation.underline"],
    });
    expect(parseSpeechRefinementProviderResult({
      status: "REFINED",
      refinedTranscript: "여기 밑줄",
      corrections: [{ kind: "disfluency" }],
    })).toEqual({
      status: "REFINED",
      refinedTranscript: "여기 밑줄",
      corrections: [{ kind: "disfluency" }],
    });
  });

  it("rejects prose fields and malformed output", () => {
    expect(() => parseSpeechRefinementProviderResult({
      status: "REFINED",
      refinedTranscript: "여기 밑줄",
      corrections: [],
      explanation: "cleanup",
    })).toThrow(SpeechRefinementValidationError);
    expect(() => parseSpeechRefinementProviderResult({
      status: "UNCHANGED",
      refinedTranscript: "not allowed",
    })).toThrow(SpeechRefinementValidationError);
  });
});

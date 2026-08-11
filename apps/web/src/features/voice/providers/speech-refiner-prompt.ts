import type { SpeechRefinementInput } from "../domain";
import type { DirectTextModelRequest } from "./direct-text-model-transport";

const MAX_TRANSCRIPT_CHARS = 4_000;

export const SPEECH_REFINER_SYSTEM_POLICY = [
  "You refine one Korean voice command before planning.",
  "Remove only fillers, repetitions, false starts, and explicit self-corrections.",
  "Preserve the final command meaning, operation, target phrases, numbers, and math expressions.",
  "Do not translate, romanize, or correct Korean phonetic spellings into English.",
  "Do not use document knowledge and do not invent document terms.",
  "Return UNCHANGED when cleanup is unnecessary.",
  "Return exactly one JSON object with no markdown or prose.",
  "Output either {\"status\":\"UNCHANGED\"} or {\"status\":\"REFINED\",\"refinedTranscript\":\"...\",\"corrections\":[{\"kind\":\"disfluency|self_correction|spacing|command_cleanup\"}]}.",
].join("\n");

export function buildSpeechRefinerModelRequest(
  input: SpeechRefinementInput,
): DirectTextModelRequest {
  return {
    instructions: SPEECH_REFINER_SYSTEM_POLICY,
    input: [{
      role: "user",
      content: JSON.stringify({
        section: "BOUNDED_UTTERANCE",
        data: {
          language: input.language,
          rawTranscript: input.rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS),
          allowedCommands: input.allowedCommands,
        },
      }),
    }],
    maxOutputTokens: 500,
  };
}

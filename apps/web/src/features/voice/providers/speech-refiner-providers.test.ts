import { describe, expect, it } from "vitest";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
} from "./direct-text-model-transport";
import { HttpSpeechRefinerProvider } from "./http-speech-refiner-provider";
import { LlmSpeechRefinerProvider } from "./llm-speech-refiner-provider";

const input = {
  rawTranscript: "어 여기 밑줄",
  language: "ko-KR",
  allowedCommands: ["annotation.underline"],
} as const;

describe("speech refiner providers", () => {
  it("uses the same-origin HTTP boundary", async () => {
    let url = "";
    let body: unknown;
    const provider = new HttpSpeechRefinerProvider({
      fetch: async (nextUrl, init) => {
        url = String(nextUrl);
        body = JSON.parse(String(init?.body)) as unknown;
        return Response.json({ result: { status: "UNCHANGED" } });
      },
    });

    await expect(provider.refine(input)).resolves.toEqual({
      status: "UNCHANGED",
    });
    expect(url).toBe("/api/voice/direct-command/refine");
    expect(body).toEqual({ input });
  });

  it("parses strict model JSON without exposing document context", async () => {
    class StubTransport implements DirectTextModelTransport {
      public request?: DirectTextModelRequest;

      public async generate(request: DirectTextModelRequest): Promise<string> {
        this.request = request;
        return JSON.stringify({
          status: "REFINED",
          refinedTranscript: "여기 밑줄",
          corrections: [{ kind: "disfluency" }],
        });
      }
    }
    const transport = new StubTransport();
    await expect(new LlmSpeechRefinerProvider(transport).refine(input))
      .resolves.toEqual({
        status: "REFINED",
        refinedTranscript: "여기 밑줄",
        corrections: [{ kind: "disfluency" }],
      });
    expect(JSON.stringify(transport.request)).toContain("어 여기 밑줄");
    expect(JSON.stringify(transport.request)).not.toContain("pageId");
    expect(JSON.stringify(transport.request)).not.toContain("candidateId");
  });
});

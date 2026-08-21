import { describe, expect, it } from "vitest";
import {
  MultimodalPlacementValidationError,
  parseMultimodalPlacementChoice,
  parseMultimodalPlacementRequest,
  type MultimodalPlacementRequest,
} from "./index";

const IMAGE = "data:image/png;base64,AA==";

function request(): MultimodalPlacementRequest {
  return {
    observationId: "observation-1",
    pageId: "page-1",
    sceneRevision: 7,
    instruction: "이 그림 아래에 메모 추가",
    draft: { kind: "NOTE", contentSummary: "short note" },
    anchor: { kind: "OBJECT", semanticRole: "FIGURE", textSummary: "diagram" },
    candidates: [
      {
        alias: "S1",
        relation: "BELOW",
        alignment: "START",
        fit: "PREFERRED",
        strategy: "ANCHOR_RELATIVE",
        clearance: "HIGH",
        softOverlap: "NONE",
        regionMatch: true,
      },
      {
        alias: "S2",
        relation: "BELOW",
        alignment: "CENTER",
        fit: "PREFERRED",
        strategy: "ANCHOR_RELATIVE",
        clearance: "MEDIUM",
        softOverlap: "LOW",
        regionMatch: true,
      },
    ],
    images: { globalOverview: IMAGE, localCandidateCrop: IMAGE },
  };
}

describe("multimodal placement schema", () => {
  it("accepts a strict compact request", () => {
    expect(parseMultimodalPlacementRequest(request())).toEqual(request());
  });

  it("accepts a current alias and NONE", () => {
    expect(parseMultimodalPlacementChoice({ choice: "S2" }, ["S1", "S2"]))
      .toEqual({ choice: "S2" });
    expect(parseMultimodalPlacementChoice({ choice: "NONE" }, ["S1", "S2"]))
      .toEqual({ choice: "NONE" });
  });

  it.each([
    [{ choice: "S3" }, "choice.choice"],
    [{ choice: "S1", reason: "best" }, "choice.reason"],
    [{ choice: "S1", x: 10 }, "choice.x"],
    [{ choice: "S1", confidence: 0.95 }, "choice.confidence"],
    ["S1 is best", "choice"],
    [JSON.parse('{"choice":"S1","__proto__":{"polluted":true}}') as unknown, "choice.__proto__"],
  ])("rejects invalid strict choices", (value, path) => {
    expect(() => parseMultimodalPlacementChoice(value, ["S1", "S2"]))
      .toThrowError(expect.objectContaining<Partial<MultimodalPlacementValidationError>>({ path }));
  });

  it("rejects request coordinate, internal identity, and malformed image fields", () => {
    expect(() => parseMultimodalPlacementRequest({ ...request(), x: 10 }))
      .toThrowError(/Unknown field/u);
    expect(() => parseMultimodalPlacementRequest({
      ...request(),
      candidates: request().candidates.map((candidate) => ({
        ...candidate,
        candidateId: "internal",
      })),
    })).toThrowError(/Unknown field/u);
    expect(() => parseMultimodalPlacementRequest({
      ...request(),
      images: { ...request().images, globalOverview: "https://example.test/image.png" },
    })).toThrowError(/bounded PNG/u);
  });

  it("rejects duplicate aliases and more than six candidates", () => {
    expect(() => parseMultimodalPlacementRequest({
      ...request(),
      candidates: [request().candidates[0], request().candidates[0]],
    })).toThrowError(/unique/u);
    expect(() => parseMultimodalPlacementRequest({
      ...request(),
      candidates: Array.from({ length: 7 }, (_, index) => ({
        ...request().candidates[0],
        alias: `S${index + 1}`,
      })),
    })).toThrowError(/between 2 and 6/u);
  });
});

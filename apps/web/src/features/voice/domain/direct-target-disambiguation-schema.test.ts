import { describe, expect, it } from "vitest";
import { parseDirectTargetDisambiguationResult } from "./direct-target-disambiguation-schema";

describe("Direct target disambiguation runtime schema", () => {
  it("accepts a bounded selection and NONE", () => {
    expect(parseDirectTargetDisambiguationResult({
      status: "SELECTED",
      candidateLabel: "C2",
    }, 2)).toEqual({ status: "SELECTED", candidateLabel: "C2" });
    expect(parseDirectTargetDisambiguationResult({ status: "NONE" }, 2))
      .toEqual({ status: "NONE" });
  });

  it("rejects an out-of-range label and any extra authority", () => {
    expect(() => parseDirectTargetDisambiguationResult({
      status: "SELECTED",
      candidateLabel: "C4",
    }, 2)).toThrow(/outside the bounded candidate set/u);
    expect(() => parseDirectTargetDisambiguationResult({
      status: "SELECTED",
      candidateLabel: "C1",
      objectId: "object-123",
    }, 2)).toThrow(/objectId: unexpected field/u);
    expect(() => parseDirectTargetDisambiguationResult({
      status: "SELECTED",
      candidateLabel: "C1",
      operation: "highlight",
    }, 2)).toThrow(/operation: unexpected field/u);
  });
});

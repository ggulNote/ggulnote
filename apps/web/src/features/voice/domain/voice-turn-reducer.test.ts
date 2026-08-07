import { describe, expect, it } from "vitest";
import { reduceVoiceTurnLifecycle } from "./voice-turn-reducer";

describe("reduceVoiceTurnLifecycle", () => {
  it("accepts the normal lifecycle", () => {
    let state = reduceVoiceTurnLifecycle("idle", { type: "START_REQUESTED" });
    expect(state).toBe("starting");
    state = reduceVoiceTurnLifecycle(state, { type: "SPEECH_STARTED" });
    expect(state).toBe("capturing");
    state = reduceVoiceTurnLifecycle(state, { type: "SPEECH_ENDED" });
    expect(state).toBe("finalizing");
    state = reduceVoiceTurnLifecycle(state, { type: "COMPLETED" });
    expect(state).toBe("completed");
  });

  it("supports stop, cancel, discard, failure, and unsupported terminals", () => {
    expect(reduceVoiceTurnLifecycle("capturing", { type: "STOP_REQUESTED" })).toBe("finalizing");
    expect(reduceVoiceTurnLifecycle("starting", { type: "CANCELLED" })).toBe("cancelled");
    expect(reduceVoiceTurnLifecycle("finalizing", { type: "DISCARDED" })).toBe("discarded");
    expect(reduceVoiceTurnLifecycle("capturing", { type: "FAILED" })).toBe("failed");
    expect(reduceVoiceTurnLifecycle("starting", { type: "UNSUPPORTED" })).toBe("unsupported");
  });

  it("blocks impossible and duplicate terminal transitions", () => {
    expect(reduceVoiceTurnLifecycle("idle", { type: "COMPLETED" })).toBe("idle");
    expect(reduceVoiceTurnLifecycle("starting", { type: "COMPLETED" })).toBe("starting");
    expect(reduceVoiceTurnLifecycle("completed", { type: "COMPLETED" })).toBe("completed");
    expect(reduceVoiceTurnLifecycle("cancelled", { type: "FAILED" })).toBe("cancelled");
  });

  it("allows a new request from every terminal state", () => {
    for (const terminal of ["completed", "discarded", "cancelled", "failed", "unsupported"] as const) {
      expect(reduceVoiceTurnLifecycle(terminal, { type: "START_REQUESTED" })).toBe("starting");
    }
  });
});

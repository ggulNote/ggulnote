import { describe, expect, it } from "vitest";
import { InteractionClock } from "../src";

describe("InteractionClock", () => {
  it("returns time relative to session start", () => {
    let providerTime = 1_000;
    const clock = new InteractionClock(() => providerTime);

    expect(clock.now()).toBe(0);

    providerTime = 1_025;
    expect(clock.now()).toBe(25);
  });

  it("does not move backward when an injected provider regresses", () => {
    let providerTime = 2_000;
    const clock = new InteractionClock(() => providerTime);

    providerTime = 2_020;
    expect(clock.now()).toBe(20);

    providerTime = 2_010;
    expect(clock.now()).toBe(20);
  });
});

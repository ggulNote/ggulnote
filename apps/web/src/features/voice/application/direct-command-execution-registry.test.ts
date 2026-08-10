import { describe, expect, it } from "vitest";
import type { DirectCommandRouteResult } from "../domain";
import { DirectCommandExecutionRegistry } from "./direct-command-execution-registry";

function cancelled(turnId: string): DirectCommandRouteResult {
  return { status: "CANCELLED", turnId };
}

describe("DirectCommandExecutionRegistry", () => {
  it("bounds completed turn memory to the configured session window", async () => {
    const registry = new DirectCommandExecutionRegistry({
      maxCompletedTurns: 2,
    });
    await registry.execute("turn-1", async () => cancelled("turn-1"));
    await registry.execute("turn-2", async () => cancelled("turn-2"));
    await registry.execute("turn-3", async () => cancelled("turn-3"));

    expect(registry.hasCompleted("turn-1")).toBe(false);
    expect(registry.hasCompleted("turn-2")).toBe(true);
    expect(registry.hasCompleted("turn-3")).toBe(true);
  });

  it("retains COMMIT_FAILED to avoid retry after an uncertain side effect", async () => {
    const registry = new DirectCommandExecutionRegistry();
    let calls = 0;
    const action = async (): Promise<DirectCommandRouteResult> => {
      calls += 1;
      return {
        status: "ERROR",
        turnId: "turn-commit-uncertain",
        errorCode: "COMMIT_FAILED",
      };
    };

    await registry.execute("turn-commit-uncertain", action);
    await registry.execute("turn-commit-uncertain", action);

    expect(calls).toBe(1);
    expect(registry.hasCompleted("turn-commit-uncertain")).toBe(true);
  });

  it("cleans in-flight state when the action rejects", async () => {
    const registry = new DirectCommandExecutionRegistry();
    await expect(registry.execute("turn-rejected", async () => {
      throw new Error("failed");
    })).rejects.toThrow("failed");
    expect(registry.hasInFlight("turn-rejected")).toBe(false);

    await expect(registry.execute(
      "turn-rejected",
      async () => cancelled("turn-rejected"),
    )).resolves.toEqual(cancelled("turn-rejected"));
  });
});

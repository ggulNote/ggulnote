import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("disabled Note Decision disambiguation route", () => {
  it("returns Gone without invoking a provider", async () => {
    const response = POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ONE_DECISION_REQUIRED",
        message: "Target disambiguation must be included in the initial Note Decision.",
      },
    });
  });
});

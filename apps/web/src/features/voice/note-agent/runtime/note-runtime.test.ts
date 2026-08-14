import { buildSceneSnapshot } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import type { FrozenVoiceTurnContext, PageTargetCatalog } from "../../domain";
import {
  NoteAgentValidationError,
  type NoteDecision,
} from "../domain";
import {
  ExistingWorldResolver,
  type FrozenWorldContext,
  type UnifiedObjectWorld,
} from "../world";
import {
  NoteToolRegistry,
  type NoteSchema,
  type NoteTool,
  type NoteToolContext,
  type NoteRuntimeContext,
} from "../tools";
import { NoteRuntime } from "./note-runtime";

const PAGE_ID = "page-1";

function createWorld(): UnifiedObjectWorld {
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: 7,
  });
  return {
    getSnapshot: (pageId, revision) =>
      pageId === PAGE_ID && revision === 7 ? scene : undefined,
    getObject: () => undefined,
    getObjectMetadata: () => undefined,
    listPageObjects: () => [],
    searchIndex: () => [],
    getRecentOperationOutputs: () => [],
  };
}

function toolContext(currentRevision = 7): NoteRuntimeContext {
  const world = createWorld();
  const frozenVoiceContext: FrozenVoiceTurnContext = {
    pageId: PAGE_ID,
    sceneMode: "blank",
    sceneRevision: 7,
    focusSource: "none",
    focusStale: false,
    capturedAt: 1,
  };
  const catalog: PageTargetCatalog = {
    documentId: "doc-1",
    pageId: PAGE_ID,
    sceneRevision: 7,
    candidates: [],
  };
  const frozenWorld: FrozenWorldContext = {
    documentId: "doc-1",
    pageId: PAGE_ID,
    sceneRevision: 7,
    frozenVoiceContext,
    catalog,
    recentOperations: [],
  };
  return {
    mode: "SHADOW",
    turnId: "turn-1",
    frozenWorld,
    world,
    resolver: new ExistingWorldResolver({ world }),
    getCurrentSceneRevision: () => currentRevision,
  };
}

function stringSchema(): NoteSchema<{ value: string }> {
  return {
    compact: { value: "string" },
    parse(value, path = "input") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new NoteAgentValidationError(path, "expected an object");
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== "value")) {
        throw new NoteAgentValidationError(path, "unexpected field");
      }
      if (typeof record.value !== "string") {
        throw new NoteAgentValidationError(`${path}.value`, "expected a string");
      }
      return { value: record.value };
    },
  };
}

function fakeTool(
  prepare = vi.fn(async (input: { value: string }) => ({
    status: "READY" as const,
    value: { echoed: input.value },
    operations: [],
  })),
  available = true,
  kind: "COMPUTE" | "MUTATION" = "COMPUTE",
): NoteTool<{ value: string }, { echoed: string }> {
  return {
    id: "test.echo",
    kind,
    description: "echo",
    examples: ["echo value"],
    inputSchema: stringSchema(),
    outputSchema: {
      compact: { echoed: "string" },
      parse: (value) => value as { echoed: string },
    },
    isAvailable: () => available,
    prepare,
  };
}

describe("NoteToolRegistry", () => {
  it("supports duplicate protection, lookup, availability, and compact schemas", () => {
    const registry = new NoteToolRegistry();
    const tool = fakeTool();
    registry.register(tool);
    expect(registry.get("test.echo")).toBe(tool);
    expect(registry.listAvailable(toolContext())).toEqual([tool]);
    expect(registry.compactSchemas(toolContext())).toEqual([{
      id: "test.echo",
      kind: "COMPUTE",
      description: "echo",
      examples: ["echo value"],
      input: { value: "string" },
    }]);
    expect(() => registry.register(tool)).toThrowError(/Duplicate NoteTool/u);

    const unavailable = fakeTool(vi.fn(), false);
    const second = new NoteToolRegistry();
    second.register(unavailable);
    expect(second.listAvailable(toolContext())).toEqual([]);
  });
});
describe("NoteRuntime shadow boundary", () => {
  it("strictly validates and executes one call without a commit port", async () => {
    const prepare = vi.fn(async (
      input: { value: string },
      _context: NoteToolContext,
    ) => ({
      status: "READY" as const,
      value: { echoed: input.value },
      operations: [],
    }));
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare));
    const runtime = new NoteRuntime({ registry });
    const decision: NoteDecision = {
      status: "CALL",
      call: { stepId: "s1", toolId: "test.echo", input: { value: "ok" } },
    };
    const result = await runtime.execute(decision, toolContext());
    expect(result).toMatchObject({ status: "SUCCESS", commitAttempted: false });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("runs up to four batch steps and stops on the first failure", async () => {
    const prepare = vi.fn(async (input: { value: string }) =>
      input.value === "fail"
        ? { status: "NOT_FOUND" as const }
        : { status: "READY" as const, value: { echoed: input.value }, operations: [] });
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare));
    const runtime = new NoteRuntime({ registry });
    const result = await runtime.execute({
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "test.echo", input: { value: "ok" } },
        { stepId: "s2", toolId: "test.echo", input: { value: "fail" } },
        { stepId: "s3", toolId: "test.echo", input: { value: "never" } },
      ],
    }, toolContext());
    expect(result).toEqual({ status: "NOT_FOUND", commitAttempted: false });
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid input, unavailable tools, unknown tools, and stale scenes", async () => {
    const registry = new NoteToolRegistry();
    registry.register(fakeTool());
    const runtime = new NoteRuntime({ registry });
    const call = (input: unknown, toolId = "test.echo") => ({
      status: "CALL" as const,
      call: { stepId: "s1", toolId: toolId as `${string}.${string}`, input },
    });
    await expect(runtime.execute(call({ extra: true }), toolContext())).resolves
      .toMatchObject({ status: "FAILED", reasonCode: "INVALID_TOOL_INPUT", commitAttempted: false });
    await expect(runtime.execute(call({}, "missing.tool"), toolContext())).resolves
      .toMatchObject({ status: "FAILED", reasonCode: "UNKNOWN_TOOL" });
    await expect(runtime.execute(call({ value: "ok" }), toolContext(8))).resolves
      .toEqual({ status: "STALE_SCENE", commitAttempted: false });
  });
});

describe("NoteRuntime production transaction boundary", () => {
  it("returns pure compute results without a transaction", async () => {
    const registry = new NoteToolRegistry();
    registry.register(fakeTool());
    const result = await new NoteRuntime({ registry }).execute({
      status: "CALL",
      call: { stepId: "s1", toolId: "test.echo", input: { value: "ok" } },
    }, { ...toolContext(), mode: "PRODUCTION" });
    expect(result).toMatchObject({ status: "SUCCESS", commitAttempted: false });
  });

  it("prepares one mutation then invokes one transaction", async () => {
    const prepare = vi.fn(async (
      input: { value: string },
      _context: NoteToolContext,
    ) => ({
      status: "READY" as const,
      value: { echoed: input.value },
      operations: [{ kind: "EXISTING_EDITOR_OPERATION" as const, data: { value: input.value } }],
    }));
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare, true, "MUTATION"));
    const commit = vi.fn(async (_input: unknown) => ({
      status: "SUCCESS" as const,
      receipt: {
        kind: "COMMITTED" as const,
        operationId: "op-1",
        planId: "plan-1",
        guardMs: 1,
        commitMs: 2,
        visualMs: 0,
      },
      commitAttempted: true as const,
    }));
    const result = await new NoteRuntime({ registry }).execute({
      status: "CALL",
      call: { stepId: "s1", toolId: "test.echo", input: { value: "ok" } },
    }, {
      ...toolContext(),
      mode: "PRODUCTION",
      transaction: { commit },
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[1]).not.toHaveProperty("transaction");
    expect(commit).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "SUCCESS",
      commitAttempted: true,
      receipt: { operationId: "op-1" },
    });
  });

  it("prepares two mutations before invoking one central transaction", async () => {
    const prepare = vi.fn(async (input: { value: string }) => ({
      status: "READY" as const,
      value: { echoed: input.value },
      operations: [{ kind: "EXISTING_EDITOR_OPERATION" as const, data: { value: input.value } }],
    }));
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare, true, "MUTATION"));
    const commit = vi.fn(async (_input: import("../tools").NoteTransactionPort extends {
      commit(input: infer T): Promise<unknown>;
    } ? T : never) => ({
      status: "SUCCESS" as const,
      receipt: {
        kind: "COMMITTED" as const,
        operationId: "op-batch",
        guardMs: 0,
        commitMs: 1,
        visualMs: 0,
      },
      commitAttempted: true as const,
    }));
    const result = await new NoteRuntime({ registry }).execute({
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "test.echo", input: { value: "one" } },
        { stepId: "s2", toolId: "test.echo", input: { value: "two" } },
      ],
    }, {
      ...toolContext(),
      mode: "PRODUCTION",
      transaction: { commit },
    });
    expect(result).toMatchObject({ status: "SUCCESS", commitAttempted: true });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].steps).toHaveLength(2);
  });

  it("does not invoke the transaction when a later mutation prepare fails", async () => {
    const prepare = vi.fn(async (input: { value: string }) =>
      input.value === "fail"
        ? { status: "NOT_FOUND" as const }
        : {
            status: "READY" as const,
            value: { echoed: input.value },
            operations: [{
              kind: "EXISTING_EDITOR_OPERATION" as const,
              data: { value: input.value },
            }],
          });
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare, true, "MUTATION"));
    const commit = vi.fn();
    const result = await new NoteRuntime({ registry }).execute({
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "test.echo", input: { value: "ready" } },
        { stepId: "s2", toolId: "test.echo", input: { value: "fail" } },
      ],
    }, {
      ...toolContext(),
      mode: "PRODUCTION",
      transaction: { commit },
    });
    expect(result).toEqual({ status: "NOT_FOUND", commitAttempted: false });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it("binds only completed step outputs before strict input validation", async () => {
    const prepare = vi.fn(async (input: { value: string }) => ({
      status: "READY" as const,
      value: { echoed: input.value },
      operations: [],
    }));
    const registry = new NoteToolRegistry();
    registry.register(fakeTool(prepare));
    const result = await new NoteRuntime({ registry }).execute({
      status: "BATCH",
      atomic: true,
      steps: [
        { stepId: "s1", toolId: "test.echo", input: { value: "prepared" } },
        {
          stepId: "s2",
          toolId: "test.echo",
          input: { value: { fromStep: "s1", path: ["echoed"] } },
        },
      ],
    }, toolContext());
    expect(result).toMatchObject({ status: "SUCCESS", commitAttempted: false });
    expect(prepare).toHaveBeenNthCalledWith(2, { value: "prepared" }, expect.any(Object));
  });
});

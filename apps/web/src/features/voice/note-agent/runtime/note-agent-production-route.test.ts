import {
  buildSceneSnapshot,
  describeSceneObject,
  type WordSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
} from "../../application";
import type { CompletedVoiceTurn } from "../../domain";
import { FakeNoteDecisionCompositionProvider } from "../decision";
import {
  createExistingNoteToolRegistry,
  NoteToolRegistry,
  unknownOutputSchema,
} from "../tools";
import type { UnifiedObjectWorld } from "../world";
import { ExistingWorldResolver } from "../world";
import { NoteAgentProductionRoute } from "./note-agent-production-route";

const WORD: WordSceneObject = {
  id: "pdf-word-1", pageId: "page-1", source: "pdf", kind: "word",
  bounds: { x: 10, y: 20, width: 100, height: 20 }, zIndex: 0,
  visible: true, locked: true, objectRevision: 1, sourceObjectId: "word-1",
  text: "hello", readingOrder: 1, lineId: "line-1",
  charOffsetStart: 0, charOffsetEnd: 5,
};
const SCENE = buildSceneSnapshot({
  mode: "pdf",
  page: { id: "page-1", index: 0, width: 600, height: 800 },
  sceneRevision: 7,
  pdfObjects: [WORD],
});

describe("NoteAgentProductionRoute", () => {
  it("owns a duplicate turn exactly once and commits through one transaction", async () => {
    const provider = new FakeNoteDecisionCompositionProvider({
      status: "CALL",
      call: { stepId: "s1", toolId: "navigation.next_page", input: {} },
    });
    const commit = vi.fn(async () => ({
      status: "SUCCESS" as const,
      receipt: {
        kind: "NAVIGATED" as const,
        direction: "next_page" as const,
        guardMs: 0, commitMs: 1, visualMs: 0,
      },
      commitAttempted: true as const,
    }));
    const route = setup(createExistingNoteToolRegistry(), provider, commit);
    const completed = turn();
    const [first, duplicate] = await Promise.all([
      route.execute(completed),
      route.execute(completed),
    ]);
    expect(first).toEqual({ status: "NAVIGATED", turnId: "turn-1", direction: "next_page" });
    expect(duplicate).toEqual(first);
    expect(provider.decisionCallCount).toBe(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(route.traces.getAll()[0]).toMatchObject({
      shadowMode: false,
      llmCallCount: 1,
      decisionCallCount: 1,
      contextAssemblyMs: expect.any(Number),
      prepareMs: expect.any(Number),
      worldResolveMs: expect.any(Number),
      visualCallCount: 0,
      usedAmbiguityPass: false,
      usedVisualFallback: false,
      commitAttempted: true,
    });
  });

  it("does not run a separate target-selection agent after One Decision", async () => {
    const registry = new NoteToolRegistry();
    registry.register({
      id: "test.choose",
      kind: "COMPUTE",
      description: "test bounded ambiguity",
      examples: ["choose one"],
      inputSchema: { compact: {}, parse: () => ({}) },
      outputSchema: unknownOutputSchema,
      isAvailable: () => true,
      prepare: async (_input, context) => context.candidateSelection === undefined
        ? {
            status: "AMBIGUOUS" as const,
            candidates: [
              { label: "C1", kind: "text", textPreview: "first" },
              { label: "C2", kind: "text", textPreview: "second" },
            ],
          }
        : {
            status: "READY" as const,
            value: { selectedAlias: context.candidateSelection.alias },
            operations: [],
          },
    });
    const prepareCommit = vi.fn();
    const provider = new FakeNoteDecisionCompositionProvider({
      status: "CALL",
      call: { stepId: "s1", toolId: "test.choose", input: {} },
    }, { status: "SELECTED", alias: "C2" });
    const route = setup(registry, provider, prepareCommit);
    await expect(route.execute(turn())).resolves.toMatchObject({
      status: "TARGET_AMBIGUOUS",
    });
    expect(provider.decisionCallCount).toBe(1);
    expect(provider.disambiguationCallCount).toBe(0);
    expect(prepareCommit).not.toHaveBeenCalled();
    expect(route.traces.getAll()[0]).toMatchObject({
      llmCallCount: 1,
      decisionCallCount: 1,
      usedAmbiguityPass: false,
      commitAttempted: false,
    });
  });

  it.each([
    ["다음 페이지", "navigation.next_page", "NAVIGATED"],
    ["이전 페이지", "navigation.previous_page", "NAVIGATED"],
    ["실행 취소", "history.undo", "UNDONE"],
  ] as const)(
    "routes %s through exactly one Decision Provider call",
    async (transcript, action, expectedStatus) => {
      const provider = new FakeNoteDecisionCompositionProvider({
        status: "READY",
        sceneRevision: 7,
        steps: [{ action, target: null, args: {}, destination: null }],
      });
      const commit = vi.fn(async (input: {
        steps: readonly { readonly toolId: string }[];
      }) => ({
        status: "SUCCESS" as const,
        receipt: action === "history.undo"
          ? {
              kind: "UNDONE" as const,
              operationId: "operation-undo",
              guardMs: 0, commitMs: 1, visualMs: 0,
            }
          : {
              kind: "NAVIGATED" as const,
              direction: action === "navigation.next_page" ? "next_page" as const : "previous_page" as const,
              guardMs: 0, commitMs: 1, visualMs: 0,
            },
        commitAttempted: true as const,
      }));
      const route = setup(createExistingNoteToolRegistry(), provider, commit);

      await expect(route.execute(turn(transcript, `turn-${action}`)))
        .resolves.toMatchObject({ status: expectedStatus });
      expect(provider.decisionCallCount).toBe(1);
      expect(provider.disambiguationCallCount).toBe(0);
      expect(commit).toHaveBeenCalledOnce();
      expect(commit.mock.calls[0]?.[0].steps).toMatchObject([{ toolId: action }]);
    },
  );

  it("rejects a model-invented object handle before commit", async () => {
    const provider = new FakeNoteDecisionCompositionProvider({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "text.replace",
        target: { object: "O99", part: null },
        args: { text: "수정" },
        destination: null,
      }],
    });
    const commit = vi.fn();
    const route = setup(createExistingNoteToolRegistry(), provider, commit);

    await expect(route.execute(turn("없는 객체를 수정해", "turn-invalid-handle")))
      .resolves.toMatchObject({ status: "ERROR" });
    expect(provider.decisionCallCount).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(route.traces.getAll()[0]).toMatchObject({
      resultStatus: "FAILED",
      commitAttempted: false,
    });
  });
});

function setup(
  registry: NoteToolRegistry,
  provider: FakeNoteDecisionCompositionProvider,
  commit: ReturnType<typeof vi.fn>,
) {
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) => pageId === "page-1" && revision === 7 ? SCENE : undefined,
    getObject: (id) => id === WORD.id ? WORD : undefined,
    getObjectMetadata: (id) => id === WORD.id ? describeSceneObject(WORD, { documentId: "doc-1" }) : undefined,
    listPageObjects: () => [WORD], searchIndex: () => [], getRecentOperationOutputs: () => [],
  };
  const contextBuilder = new DirectCommandContextBuilder({
    frozenSceneSource: new CurrentRevisionSceneSnapshotSource(() => ({
      documentId: "doc-1", scene: SCENE,
    })),
    recentOperationsSource: { getRecentOperations: () => [] },
  });
  return new NoteAgentProductionRoute({
    contextBuilder,
    history: new DirectCommandHistoryContext(),
    world,
    registry,
    provider,
    createToolContext: (frozenWorld, turnId, options) => ({
      mode: "PRODUCTION",
      turnId,
      frozenWorld,
      world,
      resolver: new ExistingWorldResolver({ world }),
      getCurrentSceneRevision: () => 7,
      metrics: options.metrics,
      ...(options.candidateSelection === undefined
        ? {}
        : { candidateSelection: options.candidateSelection }),
      transaction: { commit },
    }),
  });
}

function turn(transcript = "다음 페이지", id = "turn-1"): CompletedVoiceTurn {
  return {
    id, providerId: "fake", providerSessionId: "session",
    language: "ko-KR", requestedAt: 1, startedAt: 2, completedAt: 4,
    state: "completed", rawTranscript: transcript,
    finalSegments: [{ id: "segment-1", index: 0, text: transcript }],
    frozenContext: {
      pageId: "page-1", sceneMode: "pdf", sceneRevision: 7,
      focusSource: "none", focusStale: false, capturedAt: 2,
    },
    focusSnapshot: {
      source: "none", capturedAt: 2, pageId: "page-1",
      sceneRevision: 7, stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 7, pageIdAtSpeechStart: "page-1",
      currentSceneRevisionAtCompletion: 7,
      sceneChangedDuringTurn: false, pageChangedDuringTurn: false,
    },
    metrics: { interimUpdateCount: 0, finalSegmentCount: 1, providerRestartCount: 0 },
  };
}

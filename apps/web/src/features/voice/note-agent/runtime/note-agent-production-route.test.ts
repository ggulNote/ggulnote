import {
  buildSceneSnapshot,
  describeSceneObject,
  type SceneObject,
  type SceneSnapshot,
  type TextSceneObject,
  type WordSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
} from "../../application";
import type { CompletedVoiceTurn } from "../../domain";
import {
  FakeNoteDecisionProvider,
  type NoteDecisionProvider,
} from "../decision";
import type { NoteDecisionInput } from "../domain";
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
const COMPLEX_OBJECTS: readonly TextSceneObject[] = Array.from(
  { length: 5 },
  (_, index) => ({
    id: `canvas:page-1:text:${index + 1}`,
    pageId: "page-1",
    source: "canvas" as const,
    kind: "text" as const,
    bounds: { x: 30 + index * 85, y: 100 + index * 45, width: 70, height: 30 },
    zIndex: index + 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: `shape-${index + 1}`,
    text: `note ${index + 1}`,
    style: { fontSize: 18 },
    createdAt: index + 1,
    updatedAt: index + 1,
  }),
);
const COMPLEX_SCENE = buildSceneSnapshot({
  mode: "pdf",
  page: { id: "page-1", index: 0, width: 600, height: 800 },
  sceneRevision: 7,
  pdfObjects: [WORD],
  canvasObjects: COMPLEX_OBJECTS,
});

describe("NoteAgentProductionRoute", () => {
  it("owns a duplicate turn exactly once and commits through one transaction", async () => {
    const provider = new FakeNoteDecisionProvider({
      status: "READY",
      sceneRevision: 7,
      steps: [{ action: "navigation.next_page", target: null, args: {}, destination: null }],
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
    expect(provider.callCount).toBe(1);
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
      prepare: async () => ({
        status: "AMBIGUOUS" as const,
        candidates: [
          { label: "C1", kind: "text", textPreview: "first" },
          { label: "C2", kind: "text", textPreview: "second" },
        ],
      }),
    });
    const prepareCommit = vi.fn();
    const provider = new FakeNoteDecisionProvider({
      status: "READY",
      sceneRevision: 7,
      steps: [{ action: "test.choose", target: null, args: {}, destination: null }],
    });
    const route = setup(registry, provider, prepareCommit);
    await expect(route.execute(turn())).resolves.toMatchObject({
      status: "TARGET_AMBIGUOUS",
    });
    expect(provider.callCount).toBe(1);
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
      const provider = new FakeNoteDecisionProvider({
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
      expect(provider.callCount).toBe(1);
      expect(commit).toHaveBeenCalledOnce();
      expect(commit.mock.calls[0]?.[0].steps).toMatchObject([{ toolId: action }]);
    },
  );

  it("rejects a model-invented object handle before commit", async () => {
    const provider = new FakeNoteDecisionProvider({
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
      .resolves.toMatchObject({ status: "TARGET_NOT_FOUND" });
    expect(provider.callCount).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(route.traces.getAll()[0]).toMatchObject({
      resultStatus: "NOT_FOUND",
      errorCode: "NOT_FOUND",
      commitAttempted: false,
    });
  });

  it("records deterministic object-region grounding and the final local action", async () => {
    const registry = new NoteToolRegistry();
    const observed = vi.fn();
    registry.register({
      id: "test.inspect_target",
      kind: "COMPUTE",
      description: "inspect the resolved target",
      examples: [],
      inputSchema: { compact: {}, parse: (value) => value },
      outputSchema: unknownOutputSchema,
      isAvailable: () => true,
      prepare: async (_input, context) => {
        observed(context.resolvedTarget);
        return { status: "READY", value: { inspected: true }, operations: [] };
      },
    });
    const provider = new FakeNoteDecisionProvider({
      status: "READY",
      sceneRevision: 7,
      steps: [{
        action: "test.inspect_target",
        target: {
          object: "O1",
          part: null,
          region: { x: 0.5, y: 0, width: 0.5, height: 1 },
          fallbackPoint: null,
        },
        args: {},
        destination: null,
      }],
    });
    const route = setup(registry, provider, vi.fn(), {
      scene: COMPLEX_SCENE,
      objects: [WORD, ...COMPLEX_OBJECTS],
    });

    await expect(route.execute(turn("오른쪽 절반", "turn-region-trace")))
      .resolves.toMatchObject({ status: "COMPUTED" });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({
      mode: "OBJECT_REGION",
      objectHandle: "O1",
      canvasBounds: { x: 65, y: 100, width: 35, height: 30 },
    }));
    expect(route.traces.getAll()[0]).toMatchObject({
      groundingMode: "OBJECT_REGION",
      resolvedTargetHandle: "O1",
      resolvedCanvasBounds: { x: 65, y: 100, width: 35, height: 30 },
      finalLocalOperation: "test.inspect_target",
      resultStatus: "SUCCESS",
    });
  });

  it("attempts one marked screenshot for a simple catalog and degrades when unavailable", async () => {
    const captureVisualContext = vi.fn(async (
      _world: Parameters<NonNullable<ConstructorParameters<
        typeof NoteAgentProductionRoute
      >[0]["captureVisualContext"]>>[0],
      _markers: Parameters<NonNullable<ConstructorParameters<
        typeof NoteAgentProductionRoute
      >[0]["captureVisualContext"]>>[1],
    ) => ({ status: "UNAVAILABLE" as const }));
    const provider = new FakeNoteDecisionProvider({
      status: "READY",
      sceneRevision: 7,
      steps: [{ action: "navigation.next_page", target: null, args: {}, destination: null }],
    });
    const route = setup(
      createExistingNoteToolRegistry(),
      provider,
      navigationCommit(),
      { captureVisualContext },
    );

    await expect(route.execute(turn("다음 페이지", "turn-simple-visual")))
      .resolves.toMatchObject({ status: "NAVIGATED" });

    expect(captureVisualContext).toHaveBeenCalledOnce();
    expect(captureVisualContext.mock.calls[0]?.[1]).toEqual([]);
    expect(provider.callCount).toBe(1);
    expect(route.traces.getAll()[0]).toMatchObject({
      visualContextRequested: true,
      visualContextAttached: false,
      visualContextFailureReason: "UNAVAILABLE",
      markedScreenshotHandles: [],
      llmCallCount: 1,
    });
  });

  it("attaches Object Catalog and screenshot before one complex-scene Decision", async () => {
    const inputs: NoteDecisionInput[] = [];
    const provider: NoteDecisionProvider = {
      decide: async (input) => {
        inputs.push(input);
        return {
          status: "READY",
          sceneRevision: 7,
          steps: [{ action: "navigation.next_page", target: null, args: {}, destination: null }],
        };
      },
    };
    const captureVisualContext = vi.fn(async (
      _world: Parameters<NonNullable<ConstructorParameters<
        typeof NoteAgentProductionRoute
      >[0]["captureVisualContext"]>>[0],
      markers: Parameters<NonNullable<ConstructorParameters<
        typeof NoteAgentProductionRoute
      >[0]["captureVisualContext"]>>[1],
    ) => ({
      status: "READY" as const,
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: { x: 0, y: 0, width: 600, height: 800 },
        pixelWidth: 960,
        pixelHeight: 1_280,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        byteLength: 8,
        capturedAt: 10,
        markers,
      },
    }));
    const route = setup(
      createExistingNoteToolRegistry(),
      provider,
      navigationCommit(),
      {
        scene: COMPLEX_SCENE,
        objects: [WORD, ...COMPLEX_OBJECTS],
        captureVisualContext,
      },
    );

    await expect(route.execute(turn("풀이 하나 더 적어줘", "turn-complex-visual")))
      .resolves.toMatchObject({ status: "NAVIGATED" });

    expect(captureVisualContext).toHaveBeenCalledOnce();
    const expectedHandles = inputs[0]?.objectCatalog.objects.map((object) => object.handle);
    expect(captureVisualContext.mock.calls[0]?.[1].map((marker) => marker.id))
      .toEqual(expectedHandles);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.objectCatalog.objects).toHaveLength(5);
    expect(inputs[0]?.visualContext).toMatchObject({
      mimeType: "image/png",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      pixelWidth: 960,
      pixelHeight: 1_280,
      markedObjects: inputs[0]?.objectCatalog.objects.map((object) => ({
        objectId: object.handle,
        kind: object.kind,
        bounds: object.bounds,
      })),
    });
    expect(route.traces.getAll()[0]).toMatchObject({
      visualContextRequested: true,
      visualContextAttached: true,
      visualContextCaptureMs: expect.any(Number),
      markedScreenshotHandles: expectedHandles,
      llmCallCount: 1,
      decisionCallCount: 1,
    });
  });

  it("falls back to Catalog-only Decision when complex-scene capture is unavailable", async () => {
    const inputs: NoteDecisionInput[] = [];
    const provider: NoteDecisionProvider = {
      decide: async (input) => {
        inputs.push(input);
        return {
          status: "READY",
          sceneRevision: 7,
          steps: [{ action: "navigation.next_page", target: null, args: {}, destination: null }],
        };
      },
    };
    const captureVisualContext = vi.fn(async () => ({ status: "UNAVAILABLE" as const }));
    const route = setup(
      createExistingNoteToolRegistry(),
      provider,
      navigationCommit(),
      {
        scene: COMPLEX_SCENE,
        objects: [WORD, ...COMPLEX_OBJECTS],
        captureVisualContext,
      },
    );

    await expect(route.execute(turn("풀이 하나 더 적어줘", "turn-visual-fallback")))
      .resolves.toMatchObject({ status: "NAVIGATED" });

    expect(captureVisualContext).toHaveBeenCalledOnce();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.visualContext).toBeUndefined();
    expect(route.traces.getAll()[0]).toMatchObject({
      visualContextRequested: true,
      visualContextAttached: false,
      visualContextFailureReason: "UNAVAILABLE",
      llmCallCount: 1,
    });
  });

  it("does not attach a screenshot whose marker IDs differ from the Object Catalog", async () => {
    const inputs: NoteDecisionInput[] = [];
    const provider: NoteDecisionProvider = {
      decide: async (input) => {
        inputs.push(input);
        return {
          status: "READY",
          sceneRevision: 7,
          steps: [{ action: "navigation.next_page", target: null, args: {}, destination: null }],
        };
      },
    };
    const captureVisualContext = vi.fn(async () => ({
      status: "READY" as const,
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: { x: 0, y: 0, width: 600, height: 800 },
        pixelWidth: 600,
        pixelHeight: 800,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        byteLength: 8,
        capturedAt: 10,
        markers: [{
          id: "O99",
          bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
        }],
      },
    }));
    const route = setup(
      createExistingNoteToolRegistry(),
      provider,
      navigationCommit(),
      { captureVisualContext },
    );

    await expect(route.execute(turn("다음 페이지", "turn-marker-mismatch")))
      .resolves.toMatchObject({ status: "NAVIGATED" });

    expect(inputs[0]?.visualContext).toBeUndefined();
    expect(route.traces.getAll()[0]).toMatchObject({
      visualContextAttached: false,
      visualContextFailureReason: "MARKER_MISMATCH",
    });
  });
});

function setup(
  registry: NoteToolRegistry,
  provider: NoteDecisionProvider,
  commit: ReturnType<typeof vi.fn>,
  options: {
    readonly scene?: SceneSnapshot;
    readonly objects?: readonly SceneObject[];
    readonly captureVisualContext?: NonNullable<
      ConstructorParameters<typeof NoteAgentProductionRoute>[0]["captureVisualContext"]
    >;
  } = {},
) {
  const scene = options.scene ?? SCENE;
  const objects = options.objects ?? [WORD];
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) => pageId === "page-1" && revision === 7 ? scene : undefined,
    getObject: (id) => objects.find((object) => object.id === id),
    getObjectMetadata: (id) => {
      const object = objects.find((candidate) => candidate.id === id);
      return object === undefined ? undefined : describeSceneObject(object, { documentId: "doc-1" });
    },
    listPageObjects: () => objects,
    searchIndex: () => [],
    getRecentOperationOutputs: () => [],
  };
  const contextBuilder = new DirectCommandContextBuilder({
    frozenSceneSource: new CurrentRevisionSceneSnapshotSource(() => ({
      documentId: "doc-1", scene,
    })),
    recentOperationsSource: { getRecentOperations: () => [] },
  });
  return new NoteAgentProductionRoute({
    contextBuilder,
    history: new DirectCommandHistoryContext(),
    world,
    registry,
    provider,
    ...(options.captureVisualContext === undefined
      ? {}
      : { captureVisualContext: options.captureVisualContext }),
    createToolContext: (frozenWorld, turnId, options) => ({
      mode: "PRODUCTION",
      turnId,
      frozenWorld,
      world,
      resolver: new ExistingWorldResolver({ world }),
      getCurrentSceneRevision: () => 7,
      metrics: options.metrics,
      transaction: { commit },
    }),
  });
}

function navigationCommit() {
  return vi.fn(async () => ({
    status: "SUCCESS" as const,
    receipt: {
      kind: "NAVIGATED" as const,
      direction: "next_page" as const,
      guardMs: 0,
      commitMs: 1,
      visualMs: 0,
    },
    commitAttempted: true as const,
  }));
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

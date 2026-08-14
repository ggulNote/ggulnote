import { describe, expect, it, vi } from "vitest";
import type {
  MeasuredDraft,
  PlacementProfile,
  ReadyForDirectCommandExecution,
  SpatialPlacementQuery,
  SpatialSceneSnapshot,
} from "../domain";
import { FakeMultimodalPlacementJudgeProvider } from "../providers/testing/fake-multimodal-placement-judge-provider";
import { FakeDraftMeasurementProvider, FakePlacementProfileProvider } from "./testing/fake-placement-providers";
import { FakeSpatialSceneSource } from "./testing/fake-spatial-scene-source";
import { BoundedMultimodalPlacementResolver } from "./bounded-multimodal-placement-resolver";
import {
  MultimodalPlacementObservationBuilder,
  type SpatialObservationImageProcessor,
} from "./multimodal-placement-observation";
import {
  PreviewValidationOrchestrator,
} from "./preview-validation-orchestrator";
import {
  InMemorySpatialPreviewRendererRegistry,
  type SpatialPreviewRenderer,
} from "./spatial-preview-renderer";
import { SpatialPlacementExecutionPipeline } from "./spatial-placement-execution";

const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 50, height: 30 },
  minSize: { width: 20, height: 20 },
  resizePolicy: "FIXED",
  minClearance: 10,
  allowedRelations: ["BELOW"],
  overlayPolicy: "NEVER",
  overflowPolicy: "FAIL",
};

function snapshot(): SpatialSceneSnapshot {
  return {
    snapshotId: "spatial:page-1:7:10",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 400, height: 320 },
    editableBounds: { x: 0, y: 0, width: 400, height: 320 },
    viewportBounds: { x: 0, y: 0, width: 400, height: 320 },
    objects: [{
      id: "anchor-1",
      kind: "image",
      bounds: { x: 100, y: 100, width: 100, height: 50 },
      renderBounds: { x: 100, y: 100, width: 100, height: 50 },
      sourceLayer: "PDF_BASE",
      semanticRole: "FIGURE",
      protection: "HARD",
      visible: true,
      locked: true,
    }],
    capturedAt: 10,
  };
}

function ready(alignment: SpatialPlacementQuery["alignment"]): ReadyForDirectCommandExecution {
  const query: SpatialPlacementQuery = {
    reference: {
      kind: "TARGET",
      query: { kind: "object", objectType: "image", query: "이 그림" },
    },
    relation: "BELOW",
    alignment,
    overlayIntent: "NONE",
  };
  return {
    status: "READY_FOR_EXECUTION",
    turnId: "turn-1",
    context: {
      turn: {
        id: "turn-1",
        rawTranscript: "이 그림 아래에 메모 추가",
      },
      frozenContext: {
        pageId: "page-1",
        sceneMode: "pdf",
        sceneRevision: 7,
        focusSource: "page",
        focusStale: false,
        capturedAt: 10,
      },
      pageTargetCatalog: {
        pageId: "page-1",
        sceneRevision: 7,
        candidates: [],
      },
      recentOperations: [],
      plannerContext: { allowedCommands: ["text.create"] },
    } as unknown as ReadyForDirectCommandExecution["context"],
    plan: {
      status: "EXECUTABLE",
      planId: "plan-1",
      turnId: "turn-1",
      sceneRevision: 7,
      normalizedIntent: "이 그림 아래에 메모 추가",
      relation: "NEW",
      command: {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "그림 설명" },
      },
      placementQuery: query,
    },
    spatialAnchorTarget: {
      kind: "object",
      candidateId: "candidate-anchor",
      pageId: "page-1",
      sceneRevision: 7,
      source: "pdf",
      type: "image",
      objectId: "anchor-1",
      bounds: { x: 100, y: 100, width: 100, height: 50 },
      editable: false,
      annotatable: true,
    },
    disambiguationUsed: false,
    timestamps: { routeReceivedAt: 0 },
    diagnostics: { disambiguationUsed: false, guardStatus: "PASSED" },
  };
}

function harness(options: {
  alignment: SpatialPlacementQuery["alignment"];
  profile?: PlacementProfile;
  providerChoice?: `S${number}` | "NONE";
  providerAvailable?: boolean;
}) {
  const scene = snapshot();
  const sceneSource = new FakeSpatialSceneSource({ status: "READY", snapshot: scene });
  const profiles = new FakePlacementProfileProvider();
  profiles.register(options.profile ?? PROFILE);
  const measurements = new FakeDraftMeasurementProvider();
  const draft: MeasuredDraft = {
    draftKey: "spatial-draft:turn-1",
    capability: "text",
    kind: "TEXT",
    preferredFootprint: (options.profile ?? PROFILE).preferredSize,
    measurementSource: "RENDERER",
  };
  measurements.register(draft);

  let screenshotCalls = 0;
  let imageCalls = 0;
  const observation = new MultimodalPlacementObservationBuilder({
    screenshotSource: {
      capture: async () => {
        screenshotCalls += 1;
        return {
          status: "READY" as const,
          screenshot: {
            pageId: "page-1",
            sceneRevision: 7,
            canonicalPageBounds: scene.pageBounds,
            pixelWidth: 400,
            pixelHeight: 320,
            imageDataUrl: "data:image/png;base64,AA==",
            byteLength: 1,
            capturedAt: 11,
          },
        };
      },
    },
    imageProcessor: {
      render: async () => {
        imageCalls += 1;
        const image = {
          dataUrl: "data:image/png;base64,AA==",
          pixelWidth: 100,
          pixelHeight: 100,
          byteLength: 1,
        };
        return { globalOverview: image, localCandidateCrop: image };
      },
    } satisfies SpatialObservationImageProcessor,
    now: (() => {
      let value = 0;
      return () => value++;
    })(),
  });
  const provider = new FakeMultimodalPlacementJudgeProvider(
    options.providerChoice === undefined ? [] : [{ choice: options.providerChoice }],
  );
  const currentSceneSource = {
    getCurrentReference: () => ({ pageId: "page-1", sceneRevision: 7 }),
  };
  const multimodal = new BoundedMultimodalPlacementResolver({
    observationBuilder: observation,
    ...(options.providerAvailable === false ? {} : { provider }),
    currentSceneSource,
  });

  let previewCalls = 0;
  const renderer: SpatialPreviewRenderer = {
    id: "fake-native-text",
    render: async (input) => {
      previewCalls += 1;
      return {
        rendererId: "fake-native-text",
        snapshotId: input.scene.snapshotId,
        pageId: input.scene.pageId,
        sceneRevision: input.scene.sceneRevision,
        candidateInternalId: input.candidate.internalId,
        draftKey: input.draft.draftKey,
        actualRenderBounds: input.candidate.bounds,
        dispose: vi.fn(),
      };
    },
  };
  const renderers = new InMemorySpatialPreviewRendererRegistry();
  renderers.register("text", renderer);
  const preview = new PreviewValidationOrchestrator({
    renderers,
    currentSceneSource,
  });
  const executeSpatial = vi.fn(async (input, placement) => ({
    status: "COMMITTED" as const,
    turnId: input.turnId,
    planId: input.plan.planId,
    operationId: `operation:${placement.candidateInternalId}`,
  }));
  const pipeline = new SpatialPlacementExecutionPipeline({
    sceneSource,
    createSceneReference: () => ({
      pageId: "page-1",
      sceneRevision: 7,
      capturedAt: 10,
      rotation: 0,
      viewportBounds: scene.viewportBounds,
    }),
    profiles,
    measurements,
    multimodal,
    preview,
    executor: { executeSpatial },
  });
  return {
    pipeline,
    ready: ready(options.alignment),
    scene,
    draft,
    profile: options.profile ?? PROFILE,
    provider,
    executeSpatial,
    screenshotCalls: () => screenshotCalls,
    imageCalls: () => imageCalls,
    previewCalls: () => previewCalls,
  };
}

describe("SpatialPlacementExecutionPipeline", () => {
  it("keeps the deterministic fast path screenshot/VLM-free and commits after preview", async () => {
    const test = harness({ alignment: "START" });
    const result = await test.pipeline.execute(test.ready);

    expect(result.result.status).toBe("COMMITTED");
    expect(result.diagnostics).toMatchObject({
      deterministicGate: "RESOLVED",
      shortlistCandidateCount: 1,
      multimodalCallCount: 0,
      multimodalProviderResult: "NOT_REQUIRED",
      screenshotCallCount: 0,
      previewAttemptCount: 1,
      validationResult: "VALIDATED",
      runtimeExecuted: true,
      operationRecorded: true,
    });
    expect(test.screenshotCalls()).toBe(0);
    expect(test.imageCalls()).toBe(0);
    expect(test.provider.callCount).toBe(0);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it("uses exactly one bounded multimodal choice for a real ambiguity", async () => {
    const test = harness({ alignment: "AUTO", providerChoice: "S2" });
    const result = await test.pipeline.execute(test.ready);

    expect(result.result.status).toBe("COMMITTED");
    expect(result.diagnostics).toMatchObject({
      deterministicGate: "AMBIGUOUS",
      shortlistCandidateCount: 3,
      multimodalUsed: true,
      multimodalCallCount: 1,
      multimodalProviderResult: "S2",
      screenshotCallCount: 1,
      selectionSource: "MULTIMODAL",
      previewAttemptCount: 1,
    });
    expect(test.screenshotCalls()).toBe(1);
    expect(test.imageCalls()).toBe(1);
    expect(test.provider.callCount).toBe(1);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it("prepares VLM choice and preview without mutation, then commits the prepared result once", async () => {
    const test = harness({ alignment: "AUTO", providerChoice: "S2" });
    const query = test.ready.plan.placementQuery;
    if (query === undefined) throw new Error("Expected placement query.");
    const structuredInstruction = JSON.stringify({
      destination: { kind: "RELATIVE", relation: "BELOW" },
    });
    const preparation = await test.pipeline.preparePlacement({
      snapshot: test.scene,
      query,
      draft: test.draft,
      profile: test.profile,
      instruction: structuredInstruction,
      anchor: {
        kind: "OBJECT",
        objectId: "anchor-1",
        bounds: { x: 100, y: 100, width: 100, height: 50 },
      },
    });

    expect(preparation.status).toBe("READY");
    expect(test.provider.callCount).toBe(1);
    expect(test.provider.requests[0]?.instruction).toBe(structuredInstruction);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).not.toHaveBeenCalled();
    if (preparation.status !== "READY") throw new Error("Expected prepared placement.");

    const committed = await test.pipeline.executePrepared(
      test.ready,
      preparation.prepared,
    );
    expect(committed.result.status).toBe("COMMITTED");
    expect(committed.diagnostics).toMatchObject({
      multimodalCallCount: 1,
      screenshotCallCount: 1,
      previewAttemptCount: 1,
      commitGuard: "PASSED",
      runtimeExecuted: true,
    });
    expect(test.provider.callCount).toBe(1);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it("keeps provider NONE unresolved with no preview or editor mutation", async () => {
    const test = harness({ alignment: "AUTO", providerChoice: "NONE" });
    const result = await test.pipeline.execute(test.ready);

    expect(result.result).toMatchObject({
      status: "ERROR",
      errorCode: "NO_FEASIBLE_PLACEMENT",
    });
    expect(result.diagnostics).toMatchObject({
      deterministicGate: "AMBIGUOUS",
      multimodalCallCount: 1,
      multimodalProviderResult: "NONE",
      screenshotCallCount: 1,
      previewAttemptCount: 0,
      runtimeExecuted: false,
      operationRecorded: false,
    });
    expect(test.provider.callCount).toBe(1);
    expect(test.previewCalls()).toBe(0);
    expect(test.executeSpatial).not.toHaveBeenCalled();
  });

  it("executes a PAGE free-space create through the same bounded pipeline", async () => {
    const test = harness({
      alignment: "AUTO",
      providerChoice: "S1",
      profile: { ...PROFILE, allowedRelations: ["FREE_SPACE"] },
    });
    test.ready.plan.placementQuery = {
      reference: { kind: "PAGE" },
      relation: "FREE_SPACE",
      alignment: "AUTO",
      overlayIntent: "NONE",
    };

    const result = await test.pipeline.execute(test.ready);

    expect(result.result.status).toBe("COMMITTED");
    expect(result.diagnostics.shortlistCandidateCount).toBeGreaterThan(0);
    expect(result.diagnostics.multimodalCallCount).toBeLessThanOrEqual(1);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it.each([
    { mode: "AUTO_FLOW", choicePolicy: "WRITING_FLOW" },
    { mode: "EXPLICIT_REGION", choicePolicy: "EXPLICIT_REGION" },
  ] as const)("keeps $mode layout ties screenshot/VLM-free", async ({
    mode,
    choicePolicy,
  }) => {
    const test = harness({
      alignment: "AUTO",
      profile: { ...PROFILE, allowedRelations: ["FREE_SPACE"] },
    });
    const query = {
      reference: { kind: "PAGE" as const },
      relation: "FREE_SPACE" as const,
      regionHint: "TOP" as const,
      alignment: "START" as const,
      overlayIntent: "NONE" as const,
    };
    test.ready.plan.placementQuery = query;
    test.ready.textPlacement = {
      mode,
      provenance: mode === "AUTO_FLOW" ? "SYSTEM_DEFAULT" : "TRANSCRIPT_RECOVERED",
      choicePolicy,
      effectiveQuery: query,
      plannerPlacementPresent: false,
      evidenceKind: mode === "AUTO_FLOW" ? "NONE" : "EXPLICIT_REGION",
      evidenceTokens: [],
      conflictRecovered: false,
      recoveryApplied: true,
      recoveryReason: "MISSING_PLACEMENT_QUERY",
      ...(mode === "AUTO_FLOW" ? { autoFlowSource: "PAGE_ORIGIN" as const } : {}),
    };

    const result = await test.pipeline.execute(test.ready);

    expect(result.result.status).toBe("COMMITTED");
    expect(result.diagnostics).toMatchObject({
      deterministicGate: "RESOLVED",
      placementChoicePolicy: choicePolicy,
      screenshotCallCount: 0,
      multimodalCallCount: 0,
      previewAttemptCount: 1,
      stableFallbackUsed: false,
    });
    expect(test.provider.callCount).toBe(0);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it("uses a stable safe fallback for delegated free-space when the provider is unavailable", async () => {
    const test = harness({
      alignment: "AUTO",
      providerAvailable: false,
    });
    const query = test.ready.plan.placementQuery;
    if (query === undefined) throw new Error("Expected placement query.");
    test.ready.textPlacement = {
      mode: "AUTO_FREE_SPACE",
      provenance: "TRANSCRIPT_RECOVERED",
      choicePolicy: "USER_DELEGATED_LAYOUT",
      effectiveQuery: query,
      plannerPlacementPresent: false,
      evidenceKind: "AUTO_FREE_SPACE",
      evidenceTokens: ["빈 공간에"],
      conflictRecovered: false,
      recoveryApplied: true,
      recoveryReason: "MISSING_PLACEMENT_QUERY",
    };

    const result = await test.pipeline.execute(test.ready);

    expect(result.result.status).toBe("COMMITTED");
    expect(result.diagnostics).toMatchObject({
      deterministicGate: "AMBIGUOUS",
      placementChoicePolicy: "USER_DELEGATED_LAYOUT",
      multimodalProviderResult: "UNAVAILABLE",
      screenshotCallCount: 0,
      multimodalCallCount: 0,
      stableFallbackUsed: true,
      previewAttemptCount: 1,
    });
    expect(test.provider.callCount).toBe(0);
    expect(test.previewCalls()).toBe(1);
    expect(test.executeSpatial).toHaveBeenCalledTimes(1);
  });

  it("returns no feasible placement with no observation, preview, or mutation", async () => {
    const test = harness({
      alignment: "START",
      profile: {
        ...PROFILE,
        preferredSize: { width: 500, height: 500 },
        minSize: { width: 500, height: 500 },
      },
    });
    const result = await test.pipeline.execute(test.ready);

    expect(result.result).toMatchObject({
      status: "ERROR",
      errorCode: "NO_FEASIBLE_PLACEMENT",
    });
    expect(test.screenshotCalls()).toBe(0);
    expect(test.provider.callCount).toBe(0);
    expect(test.previewCalls()).toBe(0);
    expect(test.executeSpatial).not.toHaveBeenCalled();
  });
});

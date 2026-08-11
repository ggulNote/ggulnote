import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import {
  DirectAiProviderError,
  type MeasuredDraft,
  type MultimodalPlacementChoice,
  type PlacementCandidate,
  type PlacementProfile,
  type SpatialPlacementQuery,
  type SpatialPlacementResult,
  type SpatialSceneSnapshot,
} from "../domain";
import type { MultimodalPlacementJudgeProvider } from "../providers/multimodal-placement-judge-provider";
import { FakeMultimodalPlacementJudgeProvider } from "../providers/testing/fake-multimodal-placement-judge-provider";
import {
  MultimodalPlacementObservationBuilder,
  type SpatialObservationImageProcessor,
} from "./multimodal-placement-observation";
import type { SpatialScreenshotSource } from "./spatial-screenshot-source";
import { BoundedMultimodalPlacementResolver } from "./bounded-multimodal-placement-resolver";

const IMAGE = "data:image/png;base64,AA==";

function snapshot(): SpatialSceneSnapshot {
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    editableBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    viewportBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    objects: [],
    capturedAt: 1,
  };
}

function candidate(
  internalId: string,
  alias: `S${number}`,
  bounds: Rect,
  alignment: PlacementCandidate["alignment"],
): PlacementCandidate {
  return {
    internalId,
    alias,
    snapshotId: "snapshot-1",
    sceneRevision: 7,
    bounds,
    strategy: "ANCHOR_RELATIVE",
    relation: "BELOW",
    alignment,
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 40,
      anchorDistance: 20,
      relationSatisfied: true,
      alignmentSatisfied: true,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: [],
    },
  };
}

const CANDIDATES = [
  candidate("internal-a", "S1", { x: 300, y: 440, width: 200, height: 100 }, "START"),
  candidate("internal-b", "S2", { x: 400, y: 440, width: 200, height: 100 }, "CENTER"),
  candidate("internal-c", "S3", { x: 500, y: 440, width: 200, height: 100 }, "END"),
] as const;
const QUERY: SpatialPlacementQuery = {
  reference: { kind: "PAGE" },
  relation: "BELOW",
  alignment: "AUTO",
};
const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 200, height: 100 },
  minSize: { width: 100, height: 50 },
  resizePolicy: "FIXED",
  minClearance: 20,
  allowedRelations: ["BELOW"],
  overlayPolicy: "NEVER",
  overflowPolicy: "FAIL",
};
const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 200, height: 100 },
  contentSummary: "diagram note",
  measurementSource: "RENDERER",
};

function ambiguous(): SpatialPlacementResult {
  return { status: "AMBIGUOUS", candidates: CANDIDATES };
}

function harness(provider?: MultimodalPlacementJudgeProvider) {
  const capture = vi.fn<SpatialScreenshotSource["capture"]>().mockResolvedValue({
    status: "READY",
    screenshot: {
      pageId: "page-1",
      sceneRevision: 7,
      canonicalPageBounds: snapshot().pageBounds,
      pixelWidth: 500,
      pixelHeight: 700,
      imageDataUrl: IMAGE,
      byteLength: 1,
      capturedAt: 2,
    },
  });
  const render = vi.fn<SpatialObservationImageProcessor["render"]>().mockResolvedValue({
    globalOverview: { dataUrl: IMAGE, pixelWidth: 500, pixelHeight: 700, byteLength: 1 },
    localCandidateCrop: { dataUrl: IMAGE, pixelWidth: 250, pixelHeight: 180, byteLength: 1 },
  });
  let current = { pageId: "page-1", sceneRevision: 7 };
  const resolver = new BoundedMultimodalPlacementResolver({
    observationBuilder: new MultimodalPlacementObservationBuilder({
      screenshotSource: { capture },
      imageProcessor: { render },
      now: () => 10,
      createObservationId: () => "observation-1",
    }),
    ...(provider === undefined ? {} : { provider }),
    currentSceneSource: { getCurrentReference: () => current },
    now: () => 20,
  });
  return {
    resolver,
    capture,
    render,
    setCurrent: (next: typeof current) => {
      current = next;
    },
  };
}

function input(phaseBResult: SpatialPlacementResult, signal?: AbortSignal) {
  return {
    phaseBResult,
    snapshot: snapshot(),
    query: QUERY,
    draft: DRAFT,
    profile: PROFILE,
    instruction: "이 그림 아래에 메모 추가",
    ...(signal === undefined ? {} : { signal }),
  };
}

describe("BoundedMultimodalPlacementResolver", () => {
  it.each([
    {
      name: "unique/dominant RESOLVED",
      result: {
        status: "RESOLVED",
        source: "DETERMINISTIC",
        placement: {
          snapshotId: "snapshot-1",
          pageId: "page-1",
          sceneRevision: 7,
          bounds: CANDIDATES[0].bounds,
          relation: "BELOW",
          alignment: "START",
          candidate: CANDIDATES[0],
        },
      } satisfies SpatialPlacementResult,
    },
    {
      name: "NO_FEASIBLE_PLACEMENT",
      result: { status: "NO_FEASIBLE_PLACEMENT" } satisfies SpatialPlacementResult,
    },
    {
      name: "STALE_SCENE",
      result: { status: "STALE_SCENE" } satisfies SpatialPlacementResult,
    },
  ])("keeps the $name fast path at screenshot 0 and provider 0", async ({ result }) => {
    const provider = new FakeMultimodalPlacementJudgeProvider([{ choice: "S1" }]);
    const { resolver, capture, render } = harness(provider);
    const resolved = await resolver.resolve(input(result));
    expect(resolved.result).toBe(result);
    expect(resolved.diagnostics).toMatchObject({
      multimodalRequired: false,
      providerCallCount: 0,
      providerResult: "NOT_REQUIRED",
    });
    expect(capture).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(provider.callCount).toBe(0);
  });

  it("builds one observation, calls the provider once, and selects the request-scoped alias", async () => {
    const provider = new FakeMultimodalPlacementJudgeProvider([{ choice: "S2" }]);
    const { resolver, capture, render } = harness(provider);
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result).toMatchObject({
      status: "RESOLVED",
      source: "MULTIMODAL",
      placement: { candidate: { internalId: "internal-b" } },
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(provider.callCount).toBe(1);
    expect(resolved.diagnostics).toMatchObject({
      multimodalRequired: true,
      providerCallCount: 1,
      providerResult: "S2",
    });
  });

  it("treats NONE as unresolved with no deterministic fallback", async () => {
    const provider = new FakeMultimodalPlacementJudgeProvider([{ choice: "NONE" }]);
    const { resolver } = harness(provider);
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe("NO_FEASIBLE_PLACEMENT");
    expect(resolved.diagnostics.providerResult).toBe("NONE");
    expect(provider.callCount).toBe(1);
  });

  it("does not capture or guess when the provider is unavailable", async () => {
    const { resolver, capture } = harness();
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe("PROVIDER_UNAVAILABLE");
    expect(resolved.diagnostics.providerCallCount).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    [new DirectAiProviderError("PLANNER_UNAVAILABLE", "MISSING_CONFIGURATION"), "PROVIDER_UNAVAILABLE", "UNAVAILABLE"],
    [new DirectAiProviderError("PLANNER_TIMEOUT", "TIMEOUT"), "PROVIDER_ERROR", "ERROR"],
    [new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE"), "PROVIDER_ERROR", "ERROR"],
    [new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT"), "INVALID_PROVIDER_CHOICE", "INVALID"],
  ] as const)("normalizes one provider failure without retry", async (error, status, diagnostic) => {
    const provider = new FakeMultimodalPlacementJudgeProvider([error]);
    const { resolver } = harness(provider);
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe(status);
    expect(resolved.diagnostics.providerResult).toBe(diagnostic);
    expect(provider.callCount).toBe(1);
  });

  it("rejects an invalid alias returned by a custom provider", async () => {
    const judge = vi.fn(async () => ({ choice: "S9" }) as MultimodalPlacementChoice);
    const { resolver } = harness({ judge });
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe("INVALID_PROVIDER_CHOICE");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider choice if the live scene changes during the call", async () => {
    let changeRevision = () => {};
    const provider: MultimodalPlacementJudgeProvider = {
      judge: async () => {
        changeRevision();
        return { choice: "S1" };
      },
    };
    const test = harness(provider);
    changeRevision = () => test.setCurrent({ pageId: "page-1", sceneRevision: 8 });
    const resolved = await test.resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe("STALE_SCENE");
    expect(resolved.diagnostics.providerResult).toBe("STALE");
  });

  it("normalizes an in-flight abort and never selects a candidate", async () => {
    const controller = new AbortController();
    const provider: MultimodalPlacementJudgeProvider = {
      judge: async () => {
        controller.abort();
        throw new DirectAiProviderError("ABORTED", "ABORTED");
      },
    };
    const { resolver } = harness(provider);
    const resolved = await resolver.resolve(input(ambiguous(), controller.signal));
    expect(resolved.result.status).toBe("CANCELLED");
    expect(resolved.diagnostics.providerCallCount).toBe(1);
  });

  it("has no preview, editor, persistence, operation-log, or undo side-effect port", async () => {
    const sideEffects = {
      preview: 0,
      editorMutation: 0,
      indexedDb: 0,
      operationLog: 0,
      undo: 0,
    };
    const provider = new FakeMultimodalPlacementJudgeProvider([{ choice: "S1" }]);
    const { resolver } = harness(provider);
    const resolved = await resolver.resolve(input(ambiguous()));
    expect(resolved.result.status).toBe("RESOLVED");
    expect(sideEffects).toEqual({
      preview: 0,
      editorMutation: 0,
      indexedDb: 0,
      operationLog: 0,
      undo: 0,
    });
  });
});

import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SelectedSpatialPlacement,
  SpatialPlacementQuery,
  SpatialPlacementResult,
  SpatialSceneSnapshot,
} from "../domain";
import {
  InMemorySpatialPreviewRendererRegistry,
  SpatialPreviewUnavailableError,
  type SpatialPreviewRenderInput,
  type SpatialPreviewRenderer,
  type SpatialPreviewSession,
} from "./spatial-preview-renderer";
import {
  PreviewValidationOrchestrator,
  selectedSpatialPlacementFromResult,
} from "./preview-validation-orchestrator";

const ANCHOR: ResolvedSpatialAnchor = {
  kind: "OBJECT",
  objectId: "anchor-1",
  bounds: { x: 100, y: 50, width: 200, height: 100 },
};
const QUERY: SpatialPlacementQuery = {
  reference: { kind: "TARGET", query: { kind: "object", objectType: "image" } },
  relation: "BELOW",
  alignment: "AUTO",
  overlayIntent: "NONE",
};
const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 200, height: 80 },
  minSize: { width: 100, height: 40 },
  resizePolicy: "FIXED",
  minClearance: 10,
  allowedRelations: ["BELOW"],
  overlayPolicy: "NEVER",
  overflowPolicy: "FAIL",
};
const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 200, height: 80 },
  measurementSource: "RENDERER",
};

function snapshot(): SpatialSceneSnapshot {
  const anchorBounds = ANCHOR.bounds;
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 600, height: 800 },
    editableBounds: { x: 0, y: 0, width: 600, height: 800 },
    viewportBounds: { x: 0, y: 0, width: 600, height: 800 },
    objects: [{
      id: "anchor-1",
      kind: "image",
      bounds: anchorBounds,
      renderBounds: anchorBounds,
      sourceLayer: "PDF_BASE",
      semanticRole: "FIGURE",
      protection: "HARD",
      visible: true,
      locked: true,
    }],
    capturedAt: 1,
  };
}

function candidate(
  internalId: string,
  alias: `S${number}`,
  x: number,
): PlacementCandidate {
  return {
    internalId,
    alias,
    snapshotId: "snapshot-1",
    sceneRevision: 7,
    bounds: { x, y: 160, width: 200, height: 80 },
    strategy: "ANCHOR_RELATIVE",
    relation: "BELOW",
    alignment: "AUTO",
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 10,
      anchorDistance: 10,
      relationSatisfied: true,
      alignmentSatisfied: true,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: [],
    },
  };
}

const S1 = candidate("candidate-a", "S1", 100);
const S2 = candidate("candidate-b", "S2", 125);
const S3 = candidate("candidate-c", "S3", 150);
const CANDIDATES = [S1, S2, S3] as const;

type FakeOutcome =
  | Rect
  | Error
  | ((input: SpatialPreviewRenderInput) => Rect | Error);

class FakeSpatialPreviewRenderer implements SpatialPreviewRenderer {
  public readonly id = "fake-production-renderer";
  public readonly calls: SpatialPreviewRenderInput[] = [];
  public readonly disposeCounts: number[] = [];
  public activeSessions = 0;

  public constructor(
    private readonly outcomes: Readonly<Record<string, FakeOutcome>>,
  ) {}

  public async render(input: SpatialPreviewRenderInput): Promise<SpatialPreviewSession> {
    this.calls.push(input);
    const configured = this.outcomes[input.candidate.internalId];
    const outcome = typeof configured === "function" ? configured(input) : configured;
    if (outcome instanceof Error || outcome === undefined) {
      throw outcome ?? new Error("missing fake outcome");
    }
    const index = this.disposeCounts.length;
    this.disposeCounts.push(0);
    this.activeSessions += 1;
    return {
      rendererId: this.id,
      snapshotId: input.scene.snapshotId,
      pageId: input.scene.pageId,
      sceneRevision: input.scene.sceneRevision,
      candidateInternalId: input.candidate.internalId,
      draftKey: input.draft.draftKey,
      actualRenderBounds: outcome,
      dispose: () => {
        this.disposeCounts[index] += 1;
        this.activeSessions -= 1;
      },
    };
  }
}

function selected(
  candidateValue: PlacementCandidate = S2,
  source: SelectedSpatialPlacement["source"] = "MULTIMODAL",
): SelectedSpatialPlacement {
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    candidate: candidateValue,
    source,
  };
}

function harness(renderer?: SpatialPreviewRenderer) {
  const renderers = new InMemorySpatialPreviewRendererRegistry();
  if (renderer !== undefined) renderers.register("text", renderer);
  let current = { pageId: "page-1", sceneRevision: 7 };
  const orchestrator = new PreviewValidationOrchestrator({
    renderers,
    currentSceneSource: { getCurrentReference: () => current },
    now: (() => {
      let value = 0;
      return () => value++;
    })(),
  });
  return {
    orchestrator,
    setCurrent: (next: typeof current) => {
      current = next;
    },
  };
}

function input(
  selectedValue: SelectedSpatialPlacement = selected(),
  signal?: AbortSignal,
) {
  return {
    selected: selectedValue,
    candidates: CANDIDATES,
    snapshot: snapshot(),
    query: QUERY,
    profile: PROFILE,
    draft: DRAFT,
    anchor: ANCHOR,
    ...(signal === undefined ? {} : { signal }),
  };
}

describe("PreviewValidationOrchestrator", () => {
  it("previews and validates a deterministic candidate instead of skipping render", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-a": { x: 100, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input(selected(S1, "DETERMINISTIC")));
    expect(result).toMatchObject({
      status: "VALIDATED",
      placement: {
        candidateInternalId: "candidate-a",
        selectionSource: "DETERMINISTIC",
        previewAttemptCount: 1,
      },
      diagnostics: { previewAttemptCount: 1, fallbackUsed: false },
    });
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.disposeCounts).toEqual([1]);
    expect(renderer.activeSessions).toBe(0);
  });

  it("keeps a valid multimodal selection without comparing alternatives", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: 125, y: 160, width: 198, height: 78 },
      "candidate-a": new Error("must not render fallback"),
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input());
    expect(result).toMatchObject({
      status: "VALIDATED",
      placement: {
        candidateInternalId: "candidate-b",
        selectionSource: "MULTIMODAL",
      },
    });
    expect(renderer.calls.map((call) => call.candidate.internalId)).toEqual([
      "candidate-b",
    ]);
  });

  it("falls back once in stable shortlist order after geometry validation fails", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: 125, y: 160, width: 228, height: 104 },
      "candidate-a": { x: 100, y: 160, width: 198, height: 78 },
      "candidate-c": new Error("third candidate must not render"),
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input());
    expect(result).toMatchObject({
      status: "VALIDATED",
      placement: {
        candidateInternalId: "candidate-a",
        selectionSource: "VALIDATION_FALLBACK",
        previewAttemptCount: 2,
      },
      diagnostics: { previewAttemptCount: 2, fallbackUsed: true },
    });
    expect(renderer.calls.map((call) => call.candidate.internalId)).toEqual([
      "candidate-b",
      "candidate-a",
    ]);
    expect(renderer.disposeCounts).toEqual([1, 1]);
  });

  it("stops after one failed fallback and never tries S3", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: 125, y: 160, width: 228, height: 104 },
      "candidate-a": { x: 100, y: 160, width: 230, height: 110 },
      "candidate-c": { x: 150, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input());
    expect(result).toMatchObject({
      status: "VALIDATION_FAILED",
      reason: "FOOTPRINT_OVERFLOW",
      diagnostics: { previewAttemptCount: 2 },
    });
    expect(renderer.calls.map((call) => call.candidate.internalId)).toEqual([
      "candidate-b",
      "candidate-a",
    ]);
    expect(renderer.disposeCounts).toEqual([1, 1]);
  });

  it("does not fall back for invalid render geometry", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: Number.NaN, y: 160, width: 200, height: 80 },
      "candidate-a": { x: 100, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input());
    expect(result).toMatchObject({
      status: "VALIDATION_FAILED",
      reason: "INVALID_RENDER_GEOMETRY",
      diagnostics: { previewAttemptCount: 1 },
    });
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.disposeCounts).toEqual([1]);
  });

  it("returns PREVIEW_UNAVAILABLE without rendering or deterministic guessing", async () => {
    const { orchestrator } = harness();
    const result = await orchestrator.validate(input());
    expect(result).toMatchObject({
      status: "PREVIEW_UNAVAILABLE",
      diagnostics: { previewAttemptCount: 0 },
    });
  });

  it("normalizes renderer unavailable/error without fallback", async () => {
    for (const [error, status] of [
      [new SpatialPreviewUnavailableError(), "PREVIEW_UNAVAILABLE"],
      [new Error("renderer failed"), "PREVIEW_RENDER_FAILED"],
    ] as const) {
      const renderer = new FakeSpatialPreviewRenderer({ "candidate-b": error });
      const { orchestrator } = harness(renderer);
      const result = await orchestrator.validate(input());
      expect(result).toMatchObject({
        status,
        diagnostics: { previewAttemptCount: 1 },
      });
      expect(renderer.calls).toHaveLength(1);
    }
  });

  it("rejects stale input before render and stale output after render cleanup", async () => {
    const beforeRenderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: 125, y: 160, width: 198, height: 78 },
    });
    const before = harness(beforeRenderer);
    before.setCurrent({ pageId: "page-1", sceneRevision: 8 });
    const beforeResult = await before.orchestrator.validate(input());
    expect(beforeResult).toMatchObject({
      status: "STALE_SCENE",
      diagnostics: { previewAttemptCount: 0 },
    });
    expect(beforeRenderer.calls).toHaveLength(0);

    let makeStale: () => void = () => undefined;
    const afterRenderer = new FakeSpatialPreviewRenderer({
      "candidate-b": () => {
        makeStale();
        return { x: 125, y: 160, width: 198, height: 78 };
      },
    });
    const after = harness(afterRenderer);
    makeStale = () => after.setCurrent({ pageId: "page-1", sceneRevision: 8 });
    const afterResult = await after.orchestrator.validate(input());
    expect(afterResult).toMatchObject({
      status: "STALE_SCENE",
      diagnostics: {
        previewAttemptCount: 1,
        attempts: [{ cleanupCompleted: true }],
      },
    });
    expect(afterRenderer.disposeCounts).toEqual([1]);
    expect(afterRenderer.activeSessions).toBe(0);
  });

  it("cleans an aborted preview and never attempts fallback", async () => {
    const controller = new AbortController();
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": () => {
        controller.abort();
        return { x: 125, y: 160, width: 228, height: 104 };
      },
      "candidate-a": { x: 100, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input(selected(), controller.signal));
    expect(result).toMatchObject({
      status: "ABORTED",
      diagnostics: { previewAttemptCount: 1 },
    });
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.disposeCounts).toEqual([1]);
    expect(renderer.activeSessions).toBe(0);
  });

  it("rejects candidates outside the frozen shortlist before preview", async () => {
    const renderer = new FakeSpatialPreviewRenderer({
      unknown: { x: 100, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const unknown = candidate("unknown", "S9", 100);
    const result = await orchestrator.validate(input(selected(unknown)));
    expect(result).toMatchObject({
      status: "VALIDATION_FAILED",
      reason: "CANDIDATE_IDENTITY_MISMATCH",
      diagnostics: { previewAttemptCount: 0 },
    });
    expect(renderer.calls).toHaveLength(0);
  });

  it("exposes a validated-only Phase E boundary with no side-effect ports", async () => {
    const sideEffects = {
      editorMutation: vi.fn(),
      commandManager: vi.fn(),
      operationLog: vi.fn(),
      indexedDb: vi.fn(),
      undo: vi.fn(),
      autosave: vi.fn(),
      screenshot: vi.fn(),
      vlm: vi.fn(),
    };
    const renderer = new FakeSpatialPreviewRenderer({
      "candidate-b": { x: 125, y: 160, width: 198, height: 78 },
    });
    const { orchestrator } = harness(renderer);
    const result = await orchestrator.validate(input());
    expect(result.status).toBe("VALIDATED");
    for (const call of Object.values(sideEffects)) expect(call).not.toHaveBeenCalled();
  });

  it("converts both deterministic and multimodal RESOLVED results to internal selection", () => {
    for (const source of ["DETERMINISTIC", "MULTIMODAL"] as const) {
      const result: SpatialPlacementResult = {
        status: "RESOLVED",
        source,
        placement: {
          snapshotId: "snapshot-1",
          pageId: "page-1",
          sceneRevision: 7,
          bounds: S2.bounds,
          relation: "BELOW",
          alignment: "AUTO",
          candidate: S2,
        },
      };
      expect(selectedSpatialPlacementFromResult(result)).toMatchObject({
        source,
        candidate: { internalId: "candidate-b" },
      });
    }
    expect(selectedSpatialPlacementFromResult({ status: "AMBIGUOUS", candidates: CANDIDATES }))
      .toBeUndefined();
  });
});

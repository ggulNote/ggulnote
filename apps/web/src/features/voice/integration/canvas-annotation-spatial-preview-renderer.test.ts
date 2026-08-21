import type { NormalizedRect } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  SpatialSceneSnapshot,
} from "../domain";
import type { SpatialPreviewRenderInput } from "../application";
import { CanvasAnnotationSpatialPreviewRenderer } from "./canvas-annotation-spatial-preview-renderer";

function snapshot(): SpatialSceneSnapshot {
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "BLANK",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 50, y: 100, width: 100, height: 200 },
    editableBounds: { x: 50, y: 100, width: 100, height: 200 },
    viewportBounds: { x: 50, y: 100, width: 100, height: 200 },
    objects: [],
    capturedAt: 1,
  };
}

function candidate(): PlacementCandidate {
  return {
    internalId: "candidate-a",
    alias: "S1",
    snapshotId: "snapshot-1",
    sceneRevision: 7,
    bounds: { x: 60, y: 120, width: 30, height: 40 },
    strategy: "FREE_SPACE",
    relation: "FREE_SPACE",
    alignment: "AUTO",
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 100,
      anchorDistance: 0,
      relationSatisfied: true,
      alignmentSatisfied: true,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: [],
    },
  };
}

const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 30, height: 40 },
  minSize: { width: 10, height: 10 },
  resizePolicy: "FIXED",
  minClearance: 0,
  allowedRelations: ["FREE_SPACE"],
  overlayPolicy: "NEVER",
  overflowPolicy: "FAIL",
};
const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 30, height: 40 },
  measurementSource: "RENDERER",
};

function input(signal?: AbortSignal): SpatialPreviewRenderInput {
  return {
    scene: snapshot(),
    candidate: candidate(),
    draft: DRAFT,
    profile: PROFILE,
    ...(signal === undefined ? {} : { signal }),
  };
}

function createCanvas(options: { readonly failMeasurement?: boolean } = {}) {
  const style: Record<string, string> = {};
  const attributes = new Map<string, string>();
  const remove = vi.fn();
  const canvas = {
    width: 100,
    height: 200,
    style,
    remove,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  } as unknown as HTMLCanvasElement;
  const context = {
    canvas,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 12 })),
    getImageData: vi.fn(() => {
      if (options.failMeasurement) throw new Error("measurement failed");
      const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      for (let y = 20; y < 60; y += 1) {
        for (let x = 10; x < 40; x += 1) {
          data[(y * canvas.width + x) * 4 + 3] = 255;
        }
      }
      return { data };
    }),
  };
  Object.assign(canvas, { getContext: () => context });
  return { canvas, context, style, attributes, remove };
}

describe("CanvasAnnotationSpatialPreviewRenderer", () => {
  it("uses NativeCanvasRenderer on an ephemeral canvas and measures PAGE_CANONICAL pixels", async () => {
    const surface = createCanvas();
    const detach = vi.fn();
    const mount = vi.fn(() => detach);
    const receivedBounds: NormalizedRect[] = [];
    const sideEffects = {
      editorMutation: vi.fn(),
      commandManager: vi.fn(),
      operationLog: vi.fn(),
      indexedDb: vi.fn(),
      undo: vi.fn(),
      autosave: vi.fn(),
    };
    const renderer = new CanvasAnnotationSpatialPreviewRenderer({
      id: "native-canvas-text-preview",
      createCanvas: () => surface.canvas,
      mountCanvas: mount,
      createAnnotationInput: (renderInput, normalizedBounds) => {
        receivedBounds.push(normalizedBounds);
        return {
          type: "TEXT",
          pageId: renderInput.scene.pageId,
          bounds: normalizedBounds,
          text: "ghost note",
        };
      },
    });

    const session = await renderer.render(input());
    expect(receivedBounds).toEqual([{
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.2,
    }]);
    expect(surface.context.strokeRect).toHaveBeenCalledWith(10, 20, 30, 40);
    expect(session.actualRenderBounds).toEqual({
      x: 60,
      y: 120,
      width: 30,
      height: 40,
    });
    expect(surface.canvas.width).toBe(100);
    expect(surface.canvas.height).toBe(200);
    expect(surface.style).toMatchObject({
      pointerEvents: "none",
      userSelect: "none",
      position: "absolute",
      opacity: "0.55",
    });
    expect(surface.attributes.get("aria-hidden")).toBe("true");
    expect(mount).toHaveBeenCalledTimes(1);
    for (const call of Object.values(sideEffects)) expect(call).not.toHaveBeenCalled();

    await session.dispose();
    await session.dispose();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(surface.canvas.width).toBe(1);
    expect(surface.canvas.height).toBe(1);
  });

  it("cleans the transient canvas if render measurement throws", async () => {
    const surface = createCanvas({ failMeasurement: true });
    const detach = vi.fn();
    const renderer = new CanvasAnnotationSpatialPreviewRenderer({
      id: "native-canvas-text-preview",
      createCanvas: () => surface.canvas,
      mountCanvas: () => detach,
      createAnnotationInput: (renderInput, normalizedBounds) => ({
        type: "TEXT",
        pageId: renderInput.scene.pageId,
        bounds: normalizedBounds,
        text: "ghost note",
      }),
    });
    await expect(renderer.render(input())).rejects.toThrow("measurement failed");
    expect(detach).toHaveBeenCalledTimes(1);
    expect(surface.canvas.width).toBe(1);
    expect(surface.canvas.height).toBe(1);
  });

  it("rejects abort and invalid canonical candidates without clamping", async () => {
    const controller = new AbortController();
    controller.abort();
    const surface = createCanvas();
    const createAnnotationInput = vi.fn(
      (_input: SpatialPreviewRenderInput, normalizedBounds: NormalizedRect) => ({
        type: "TEXT" as const,
        pageId: "page-1",
        bounds: normalizedBounds,
        text: "ghost note",
      }),
    );
    const renderer = new CanvasAnnotationSpatialPreviewRenderer({
      id: "native-canvas-text-preview",
      createCanvas: () => surface.canvas,
      createAnnotationInput,
    });
    await expect(renderer.render(input(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(createAnnotationInput).not.toHaveBeenCalled();

    const invalid = input();
    const invalidCandidate = {
      ...invalid.candidate,
      bounds: { x: 140, y: 120, width: 30, height: 40 },
    };
    await expect(renderer.render({ ...invalid, candidate: invalidCandidate }))
      .rejects.toThrow("outside canonical page bounds");
    expect(createAnnotationInput).not.toHaveBeenCalled();
  });
});

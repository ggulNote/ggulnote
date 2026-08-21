import { describe, expect, it, vi } from "vitest";
import type { MultimodalPlacementRenderPlan } from "../application";
import { BrowserSpatialObservationImageProcessor } from "./browser-spatial-observation-image-processor";

const IMAGE = "data:image/png;base64,AA==";

function fakeCanvas() {
  const context = {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => IMAGE),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

describe("BrowserSpatialObservationImageProcessor", () => {
  it("renders one bounded overview and one marked local crop", async () => {
    const global = fakeCanvas();
    const local = fakeCanvas();
    const canvases = [global.canvas, local.canvas];
    const plan: MultimodalPlacementRenderPlan = {
      globalOverview: {
        sourcePixels: { x: 0, y: 0, width: 500, height: 700 },
        outputSize: { width: 500, height: 700 },
      },
      localCandidateCrop: {
        sourcePixels: { x: 20, y: 40, width: 300, height: 200 },
        outputSize: { width: 300, height: 200 },
        marks: [
          {
            alias: "S1",
            footprint: { x: 10, y: 20, width: 80, height: 40 },
            badge: { x: 10, y: 0, width: 38, height: 20 },
          },
          {
            alias: "S2",
            footprint: { x: 120, y: 20, width: 80, height: 40 },
            badge: { x: 120, y: 0, width: 38, height: 20 },
          },
        ],
      },
    };
    const processor = new BrowserSpatialObservationImageProcessor({
      createCanvas: () => canvases.shift()!,
      loadImage: async () => ({}) as CanvasImageSource,
    });
    const result = await processor.render({
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
        pixelWidth: 500,
        pixelHeight: 700,
        imageDataUrl: IMAGE,
        byteLength: 1,
        capturedAt: 1,
        markers: [],
      },
      plan,
    });
    expect(result.globalOverview).toMatchObject({ pixelWidth: 500, pixelHeight: 700 });
    expect(result.localCandidateCrop).toMatchObject({ pixelWidth: 300, pixelHeight: 200 });
    expect(global.context.drawImage).toHaveBeenCalledTimes(1);
    expect(local.context.drawImage).toHaveBeenCalledTimes(1);
    expect(local.context.strokeRect).toHaveBeenCalledTimes(2);
    expect(local.context.fillText).toHaveBeenNthCalledWith(1, "S1", 29, 10);
    expect(local.context.fillText).toHaveBeenNthCalledWith(2, "S2", 139, 10);
  });
});

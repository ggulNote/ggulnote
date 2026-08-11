import type { Rect } from "@ggulnote/editor-core";
import type { SpatialSceneSnapshot } from "../domain";

export interface SpatialScreenshotCaptureInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly signal?: AbortSignal;
}

export interface SpatialScreenshot {
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly canonicalPageBounds: Rect;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly imageDataUrl: string;
  readonly byteLength: number;
  readonly capturedAt: number;
}

export type SpatialScreenshotSourceResult =
  | {
      readonly status: "READY";
      readonly screenshot: SpatialScreenshot;
    }
  | {
      readonly status: "STALE_SCENE" | "UNAVAILABLE" | "CANCELLED";
      readonly error?: unknown;
    };

export interface SpatialScreenshotSource {
  capture(
    input: SpatialScreenshotCaptureInput,
  ): Promise<SpatialScreenshotSourceResult>;
}

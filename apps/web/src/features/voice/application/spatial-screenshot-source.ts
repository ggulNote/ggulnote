import type { Rect } from "@ggulnote/editor-core";
import type { SpatialSceneSnapshot } from "../domain";

export interface SpatialScreenshotCaptureInput {
  readonly snapshot: SpatialSceneSnapshot;
  /** Agent-only labels in page-normalized coordinates. */
  readonly markers?: readonly SpatialScreenshotMarker[];
  readonly signal?: AbortSignal;
}

export interface SpatialScreenshotMarker {
  readonly id: string;
  readonly kind?: string;
  readonly bounds: Rect;
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
  /** Exact markers painted into this encoded image. */
  readonly markers: readonly SpatialScreenshotMarker[];
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

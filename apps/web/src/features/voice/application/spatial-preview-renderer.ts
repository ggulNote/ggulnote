import type { CapabilityId, Rect } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialSceneSnapshot,
} from "../domain";

export interface SpatialPreviewRenderInput {
  readonly scene: SpatialSceneSnapshot;
  readonly candidate: PlacementCandidate;
  readonly draft: MeasuredDraft;
  readonly profile: PlacementProfile;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly signal?: AbortSignal;
}

export interface SpatialPreviewSession {
  readonly rendererId: string;
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly candidateInternalId: PlacementCandidate["internalId"];
  readonly draftKey: MeasuredDraft["draftKey"];
  readonly actualRenderBounds: Rect;
  dispose(): void | Promise<void>;
}

export interface SpatialPreviewRenderer {
  readonly id: string;
  render(input: SpatialPreviewRenderInput): Promise<SpatialPreviewSession>;
}

export interface SpatialPreviewRendererRegistry {
  get(capability: CapabilityId): SpatialPreviewRenderer | undefined;
}

export class InMemorySpatialPreviewRendererRegistry
implements SpatialPreviewRendererRegistry {
  private readonly renderers = new Map<CapabilityId, SpatialPreviewRenderer>();

  public register(
    capability: CapabilityId,
    renderer: SpatialPreviewRenderer,
  ): void {
    if (this.renderers.has(capability)) {
      throw new Error(`Duplicate spatial preview renderer: ${capability}`);
    }
    this.renderers.set(capability, renderer);
  }

  public unregister(capability: CapabilityId): void {
    this.renderers.delete(capability);
  }

  public get(capability: CapabilityId): SpatialPreviewRenderer | undefined {
    return this.renderers.get(capability);
  }
}

export class SpatialPreviewUnavailableError extends Error {
  public constructor(message = "A production-equivalent preview renderer is unavailable.") {
    super(message);
    this.name = "SpatialPreviewUnavailableError";
  }
}

import type { CapabilityId } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementProfile,
  SpatialSceneObject,
} from "../domain";

export interface PlacementProfileRequest {
  readonly capability: CapabilityId;
  readonly operation: string;
  readonly command: unknown;
}

export type PlacementProfileProviderResult =
  | {
      readonly status: "SUPPORTED";
      readonly profile: PlacementProfile;
    }
  | {
      readonly status: "UNSUPPORTED";
      readonly capability: CapabilityId;
      readonly reason: "CAPABILITY_NOT_REGISTERED" | "PROFILE_UNAVAILABLE";
    };

export interface PlacementProfileProvider {
  getProfile(request: PlacementProfileRequest): PlacementProfileProviderResult;
}

export type DraftMeasurementRequest =
  | {
      readonly kind: "NEW_DRAFT";
      readonly draftKey: string;
      readonly capability: CapabilityId;
      readonly command: unknown;
      readonly profile: PlacementProfile;
    }
  | {
      readonly kind: "EXISTING_OBJECT";
      readonly draftKey: string;
      readonly capability: CapabilityId;
      readonly object: SpatialSceneObject;
      readonly profile: PlacementProfile;
    };

export type DraftMeasurementProviderResult =
  | {
      readonly status: "MEASURED";
      readonly draft: MeasuredDraft;
    }
  | {
      readonly status: "UNSUPPORTED";
      readonly capability: CapabilityId;
      readonly reason: "MEASUREMENT_UNAVAILABLE" | "INVALID_DRAFT";
    };

export interface DraftMeasurementProvider {
  measure(
    request: DraftMeasurementRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DraftMeasurementProviderResult>;
}

export function measureExistingObjectDraft(
  request: Extract<DraftMeasurementRequest, { kind: "EXISTING_OBJECT" }>,
): DraftMeasurementProviderResult {
  const { width, height } = request.object.renderBounds;
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return {
      status: "UNSUPPORTED",
      capability: request.capability,
      reason: "INVALID_DRAFT",
    };
  }
  return {
    status: "MEASURED",
    draft: {
      draftKey: request.draftKey,
      capability: request.capability,
      kind: request.object.kind,
      preferredFootprint: { width, height },
      measurementSource: "EXISTING_OBJECT",
    },
  };
}

import type { CapabilityId } from "@ggulnote/editor-core";
import type { MeasuredDraft, PlacementProfile } from "../../domain";
import type {
  DraftMeasurementProvider,
  DraftMeasurementProviderResult,
  DraftMeasurementRequest,
  PlacementProfileProvider,
  PlacementProfileProviderResult,
  PlacementProfileRequest,
} from "../placement-profile-provider";

export class FakePlacementProfileProvider implements PlacementProfileProvider {
  private readonly profiles = new Map<CapabilityId, PlacementProfile>();

  public register(profile: PlacementProfile): void {
    this.profiles.set(profile.capability, cloneProfile(profile));
  }

  public getProfile(
    request: PlacementProfileRequest,
  ): PlacementProfileProviderResult {
    const profile = this.profiles.get(request.capability);
    return profile === undefined
      ? {
          status: "UNSUPPORTED",
          capability: request.capability,
          reason: "CAPABILITY_NOT_REGISTERED",
        }
      : { status: "SUPPORTED", profile: cloneProfile(profile) };
  }
}

export class FakeDraftMeasurementProvider implements DraftMeasurementProvider {
  private readonly drafts = new Map<string, MeasuredDraft>();

  public register(draft: MeasuredDraft): void {
    this.drafts.set(draft.draftKey, cloneDraft(draft));
  }

  public async measure(
    request: DraftMeasurementRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<DraftMeasurementProviderResult> {
    if (options.signal?.aborted) {
      return {
        status: "UNSUPPORTED",
        capability: request.capability,
        reason: "MEASUREMENT_UNAVAILABLE",
      };
    }
    const draft = this.drafts.get(request.draftKey);
    return draft === undefined || draft.capability !== request.capability
      ? {
          status: "UNSUPPORTED",
          capability: request.capability,
          reason: "MEASUREMENT_UNAVAILABLE",
        }
      : { status: "MEASURED", draft: cloneDraft(draft) };
  }
}

function cloneProfile(profile: PlacementProfile): PlacementProfile {
  return {
    ...profile,
    preferredSize: { ...profile.preferredSize },
    minSize: { ...profile.minSize },
    ...(profile.compactSize === undefined
      ? {}
      : { compactSize: { ...profile.compactSize } }),
    ...(profile.maxSize === undefined
      ? {}
      : { maxSize: { ...profile.maxSize } }),
    allowedRelations: [...profile.allowedRelations],
  };
}

function cloneDraft(draft: MeasuredDraft): MeasuredDraft {
  return {
    ...draft,
    preferredFootprint: { ...draft.preferredFootprint },
    ...(draft.compactFootprint === undefined
      ? {}
      : { compactFootprint: { ...draft.compactFootprint } }),
  };
}

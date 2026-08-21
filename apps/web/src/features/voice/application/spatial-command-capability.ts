import type {
  CapabilityId,
  NormalizedRect,
  Size,
} from "@ggulnote/editor-core";
import type {
  DirectEditorCommand,
  DirectAnnotationRuntimeInput,
  MeasuredDraft,
  PlacementProfile,
  ReadyForDirectCommandExecution,
  ValidatedSpatialPlacement,
} from "../domain";
import type { SpatialPreviewRenderInput } from "./spatial-preview-renderer";
import type {
  DraftMeasurementProvider,
  DraftMeasurementProviderResult,
  DraftMeasurementRequest,
  PlacementProfileProvider,
  PlacementProfileProviderResult,
  PlacementProfileRequest,
} from "./placement-profile-provider";

export interface SpatialCommandCapability {
  readonly capability: CapabilityId;
  readonly operation: string;
  profile(command: DirectEditorCommand): PlacementProfile | undefined;
  measureDraft(
    request: Extract<DraftMeasurementRequest, { kind: "NEW_DRAFT" }>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<MeasuredDraft | undefined> | MeasuredDraft | undefined;
  createPreviewAnnotationInput(
    input: SpatialPreviewRenderInput,
    normalizedBounds: NormalizedRect,
  ): DirectAnnotationRuntimeInput | undefined;
  createCommitAnnotationInput(input: {
    readonly ready: ReadyForDirectCommandExecution;
    readonly placement: ValidatedSpatialPlacement;
    readonly normalizedBounds: NormalizedRect;
    readonly pageSize: Size;
  }): DirectAnnotationRuntimeInput | undefined;
}

export interface SpatialCommandCapabilitySource {
  get(
    capability: string,
    operation: string,
  ): SpatialCommandCapability | undefined;
}

export class InMemorySpatialCommandCapabilityRegistry
implements SpatialCommandCapabilitySource,
PlacementProfileProvider,
DraftMeasurementProvider {
  private readonly capabilities = new Map<string, SpatialCommandCapability>();

  public register(capability: SpatialCommandCapability): void {
    const key = capabilityKey(capability.capability, capability.operation);
    if (this.capabilities.has(key)) {
      throw new Error(`Duplicate spatial command capability: ${key}`);
    }
    this.capabilities.set(key, capability);
  }

  public get(
    capability: string,
    operation: string,
  ): SpatialCommandCapability | undefined {
    return this.capabilities.get(capabilityKey(capability, operation));
  }

  public getProfile(
    request: PlacementProfileRequest,
  ): PlacementProfileProviderResult {
    const capability = this.get(request.capability, request.operation);
    if (capability === undefined) {
      return {
        status: "UNSUPPORTED",
        capability: request.capability,
        reason: "CAPABILITY_NOT_REGISTERED",
      };
    }
    const profile = capability.profile(request.command as DirectEditorCommand);
    return profile === undefined
      ? {
          status: "UNSUPPORTED",
          capability: request.capability,
          reason: "PROFILE_UNAVAILABLE",
        }
      : { status: "SUPPORTED", profile };
  }

  public async measure(
    request: DraftMeasurementRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<DraftMeasurementProviderResult> {
    if (request.kind !== "NEW_DRAFT") {
      return {
        status: "UNSUPPORTED",
        capability: request.capability,
        reason: "MEASUREMENT_UNAVAILABLE",
      };
    }
    const command = request.command as DirectEditorCommand;
    const operation = command.operation;
    const capability = this.get(request.capability, operation);
    if (capability === undefined || options.signal?.aborted) {
      return {
        status: "UNSUPPORTED",
        capability: request.capability,
        reason: "MEASUREMENT_UNAVAILABLE",
      };
    }
    const draft = await capability.measureDraft(request, options);
    return draft === undefined
      ? {
          status: "UNSUPPORTED",
          capability: request.capability,
          reason: "INVALID_DRAFT",
        }
      : { status: "MEASURED", draft };
  }
}

function capabilityKey(capability: string, operation: string): string {
  return `${capability}.${operation}`;
}

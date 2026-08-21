import type { NormalizedRect } from "@ggulnote/editor-core";
import type {
  DirectAnnotationRuntimeInput,
  DirectEditorCommand,
  MeasuredDraft,
  PlacementProfile,
} from "../domain";
import type {
  DraftMeasurementRequest,
  SpatialCommandCapability,
  SpatialPreviewRenderInput,
} from "../application";
import { NOTEBOOK_LAYOUT_POLICY } from "../application";

const TEXT_PROFILE = Object.freeze({
  capability: "text",
  preferredSize: Object.freeze({ width: 240, height: 96 }),
  // NativeCanvasRenderer clips TEXT to its assigned object bounds. Preview
  // validation therefore measures non-empty painted content while candidate
  // generation continues to use the preferred/compact object footprints.
  minSize: Object.freeze({ width: 8, height: 8 }),
  compactSize: Object.freeze({ width: 160, height: 64 }),
  maxSize: Object.freeze({ width: 480, height: 240 }),
  resizePolicy: "COMPACT_ONCE",
  minClearance: NOTEBOOK_LAYOUT_POLICY.naturalGap,
  allowedRelations: Object.freeze([
    "ABOVE",
    "BELOW",
    "LEFT_OF",
    "RIGHT_OF",
    "NEAR",
    "FREE_SPACE",
  ] as const),
  overlayPolicy: "EXPLICIT_ONLY",
  overflowPolicy: "FAIL",
}) satisfies PlacementProfile;

export class TextSpatialCreateCapability implements SpatialCommandCapability {
  public readonly capability = "text" as const;
  public readonly operation = "create";

  public profile(command: DirectEditorCommand): PlacementProfile | undefined {
    return isTextCreate(command) ? TEXT_PROFILE : undefined;
  }

  public measureDraft(
    request: Extract<DraftMeasurementRequest, { kind: "NEW_DRAFT" }>,
  ): MeasuredDraft | undefined {
    const command = request.command as DirectEditorCommand;
    if (!isTextCreate(command) || command.payload.text.trim().length === 0) {
      return undefined;
    }
    return Object.freeze({
      draftKey: request.draftKey,
      capability: "text" as const,
      kind: "TEXT",
      preferredFootprint: TEXT_PROFILE.preferredSize,
      compactFootprint: TEXT_PROFILE.compactSize,
      contentSummary: command.payload.text,
      measurementSource: "PROFILE_FALLBACK" as const,
    });
  }

  public createPreviewAnnotationInput(
    input: SpatialPreviewRenderInput,
    normalizedBounds: NormalizedRect,
  ): DirectAnnotationRuntimeInput | undefined {
    const text = input.draft.kind === "TEXT"
      ? input.draft.contentSummary
      : undefined;
    return text === undefined
      ? undefined
      : textInput(input.scene.pageId, normalizedBounds, text);
  }

  public createCommitAnnotationInput(
    input: Parameters<SpatialCommandCapability["createCommitAnnotationInput"]>[0],
  ): DirectAnnotationRuntimeInput | undefined {
    const command = input.ready.plan.command;
    if (!isTextCreate(command)) return undefined;
    return textInput(
      input.placement.pageId,
      input.normalizedBounds,
      command.payload.text,
    );
  }
}

function textInput(
  pageId: string,
  bounds: NormalizedRect,
  text: string,
): Extract<DirectAnnotationRuntimeInput, { type: "TEXT" }> {
  return {
    type: "TEXT",
    pageId,
    bounds: { ...bounds },
    text,
  };
}

function isTextCreate(
  command: DirectEditorCommand,
): command is Extract<DirectEditorCommand, { capability: "text"; operation: "create" }> {
  return command.capability === "text" && command.operation === "create";
}

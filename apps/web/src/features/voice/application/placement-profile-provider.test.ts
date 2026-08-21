import { describe, expect, it } from "vitest";
import type { MeasuredDraft, PlacementProfile } from "../domain";
import {
  FakeDraftMeasurementProvider,
  FakePlacementProfileProvider,
} from "./testing/fake-placement-providers";
import { measureExistingObjectDraft } from "./placement-profile-provider";

const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 240, height: 120 },
  minSize: { width: 120, height: 60 },
  compactSize: { width: 160, height: 80 },
  aspectRatio: 2,
  resizePolicy: "COMPACT_ONCE",
  minClearance: 12,
  allowedRelations: ["BELOW", "RIGHT_OF", "FREE_SPACE"],
  overlayPolicy: "EXPLICIT_ONLY",
  overflowPolicy: "FAIL",
};

const DRAFT: MeasuredDraft = {
  draftKey: "draft-note-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 238, height: 118 },
  compactFootprint: { width: 158, height: 78 },
  contentSummary: "그림 설명",
  measurementSource: "RENDERER",
};

describe("Placement profile and measurement fakes", () => {
  it("returns generic placement profiles without capability branching", () => {
    const provider = new FakePlacementProfileProvider();
    provider.register(PROFILE);

    expect(provider.getProfile({
      capability: "text",
      operation: "create",
      command: { text: "그림 설명" },
    })).toEqual({ status: "SUPPORTED", profile: PROFILE });
  });

  it("returns an explicit unsupported capability result", () => {
    const provider = new FakePlacementProfileProvider();
    expect(provider.getProfile({
      capability: "graph",
      operation: "create",
      command: {},
    })).toEqual({
      status: "UNSUPPORTED",
      capability: "graph",
      reason: "CAPABILITY_NOT_REGISTERED",
    });
  });

  it("measures registered drafts and rejects unavailable measurement", async () => {
    const provider = new FakeDraftMeasurementProvider();
    provider.register(DRAFT);

    await expect(provider.measure({
      kind: "NEW_DRAFT",
      draftKey: DRAFT.draftKey,
      capability: "text",
      command: { text: "그림 설명" },
      profile: PROFILE,
    })).resolves.toEqual({ status: "MEASURED", draft: DRAFT });

    await expect(provider.measure({
      kind: "NEW_DRAFT",
      draftKey: "missing",
      capability: "text",
      command: {},
      profile: PROFILE,
    })).resolves.toEqual({
      status: "UNSUPPORTED",
      capability: "text",
      reason: "MEASUREMENT_UNAVAILABLE",
    });
  });

  it("uses an existing object's actual render footprint for repositioning", () => {
    expect(measureExistingObjectDraft({
      kind: "EXISTING_OBJECT",
      draftKey: "move-note-1",
      capability: "text",
      object: {
        id: "canvas:page-1:text:note-1",
        kind: "text",
        bounds: { x: 10, y: 20, width: 150, height: 70 },
        renderBounds: { x: 8, y: 18, width: 154, height: 74 },
        sourceLayer: "CANVAS",
        semanticRole: "TEXT",
        protection: "HARD",
        visible: true,
        locked: false,
      },
      profile: PROFILE,
    })).toMatchObject({
      status: "MEASURED",
      draft: {
        preferredFootprint: { width: 154, height: 74 },
        measurementSource: "EXISTING_OBJECT",
      },
    });
  });
});

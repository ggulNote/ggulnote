import {
  buildSceneSnapshot,
  describeSceneObject,
  type TextSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  FrozenVoiceTurnContext,
  MeasuredDraft,
  PageTargetCatalog,
  PlacementProfile,
  SpatialSceneSnapshot,
} from "../../domain";
import {
  ExistingWorldResolver,
  RebuildableObjectIndex,
  type FrozenWorldContext,
  type UnifiedObjectWorld,
} from "../world";
import { ExistingPlacementEngine } from "./placement-engine";

const PAGE_ID = "page-1";
const REVISION = 7;
const ANCHOR_RENDER_BOUNDS = { x: 98, y: 98, width: 124, height: 44 } as const;

function setup() {
  const anchor: TextSceneObject = {
    id: "canvas-anchor",
    pageId: PAGE_ID,
    source: "canvas",
    kind: "text",
    bounds: { x: 100, y: 100, width: 120, height: 40 },
    renderBounds: ANCHOR_RENDER_BOUNDS,
    zIndex: 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: "anchor",
    text: "안녕하세요",
    style: { fontSize: 14 },
    creationOrder: 1,
  };
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: REVISION,
    canvasObjects: [anchor],
  });
  const index = new RebuildableObjectIndex();
  index.rebuild("doc-1", scene);
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === PAGE_ID && revision === REVISION ? scene : undefined,
    getObject: (id) => id === anchor.id ? anchor : undefined,
    getObjectMetadata: (id) => id === anchor.id
      ? describeSceneObject(anchor, { documentId: "doc-1" })
      : undefined,
    listPageObjects: () => [anchor],
    searchIndex: (query) => index.search(query),
    getRecentOperationOutputs: () => [],
  };
  const frozenVoiceContext: FrozenVoiceTurnContext = {
    pageId: PAGE_ID,
    sceneMode: "blank",
    sceneRevision: REVISION,
    focusObjectId: anchor.id,
    focusBounds: ANCHOR_RENDER_BOUNDS,
    focusSource: "selection",
    focusStale: false,
    capturedAt: 1,
  };
  const catalog: PageTargetCatalog = {
    documentId: "doc-1",
    pageId: PAGE_ID,
    sceneRevision: REVISION,
    candidates: [],
  };
  const context: FrozenWorldContext = {
    documentId: "doc-1",
    pageId: PAGE_ID,
    sceneRevision: REVISION,
    frozenVoiceContext,
    catalog,
    recentOperations: [],
    focus: { kind: "OBJECT", objectId: anchor.id },
    selection: { kind: "OBJECT", objectId: anchor.id },
  };
  const spatial: SpatialSceneSnapshot = {
    snapshotId: "snapshot-1",
    pageId: PAGE_ID,
    sceneRevision: REVISION,
    mode: "BLANK",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 600, height: 800 },
    editableBounds: { x: 0, y: 0, width: 600, height: 800 },
    viewportBounds: { x: 0, y: 0, width: 600, height: 800 },
    objects: [{
      id: anchor.id,
      kind: "text",
      bounds: anchor.bounds,
      renderBounds: ANCHOR_RENDER_BOUNDS,
      sourceLayer: "CANVAS",
      semanticRole: "TEXT",
      protection: "HARD",
      visible: true,
      locked: false,
    }],
    capturedAt: 1,
  };
  return { anchor, world, context, spatial };
}

const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 100, height: 30 },
  minSize: { width: 40, height: 20 },
  compactSize: { width: 80, height: 24 },
  resizePolicy: "COMPACT_ONCE",
  minClearance: 10,
  allowedRelations: ["ABOVE", "BELOW", "LEFT_OF", "RIGHT_OF", "NEAR", "INSIDE", "FREE_SPACE"],
  overlayPolicy: "EXPLICIT_ONLY",
  overflowPolicy: "FAIL",
};

const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 100, height: 30 },
  compactFootprint: { width: 80, height: 24 },
  measurementSource: "RENDERER",
};

describe("ExistingPlacementEngine facade", () => {
  it("reuses Stage 4 placement with a user-created renderBounds anchor", async () => {
    const { anchor, world, context, spatial } = setup();
    const resolver = new ExistingWorldResolver({ world });
    const result = await new ExistingPlacementEngine({ world, resolver }).resolve({
      destination: {
        kind: "RELATIVE",
        relation: "BELOW",
        anchor: { source: "USER_CREATED", content: { text: "안녕하세요" } },
        alignment: "START",
      },
      draft: DRAFT,
      profile: PROFILE,
      snapshot: spatial,
      worldContext: context,
    });
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.placement.anchor?.bounds).toEqual(ANCHOR_RENDER_BOUNDS);
      expect(result.placement.bounds.y).toBeGreaterThanOrEqual(
        ANCHOR_RENDER_BOUNDS.y + ANCHOR_RENDER_BOUNDS.height,
      );
    }
  });

  it("rejects stale spatial snapshots before candidate generation", async () => {
    const { world, context, spatial } = setup();
    const resolver = new ExistingWorldResolver({ world });
    const result = await new ExistingPlacementEngine({ world, resolver }).resolve({
      draft: DRAFT,
      profile: PROFILE,
      snapshot: { ...spatial, sceneRevision: REVISION + 1 },
      worldContext: context,
    });
    expect(result).toEqual({ status: "STALE_SCENE" });
  });

  it("resolves an explicit page region with deterministic local geometry", async () => {
    const { world, context, spatial } = setup();
    const resolver = new ExistingWorldResolver({ world });
    const result = await new ExistingPlacementEngine({
      world,
      resolver,
    }).resolve({
      destination: { kind: "PAGE_REGION", region: "TOP_LEFT" },
      draft: DRAFT,
      profile: PROFILE,
      snapshot: spatial,
      worldContext: context,
    });

    expect(result).toMatchObject({
      status: "RESOLVED",
      placement: {
        relation: "FREE_SPACE",
        candidate: { strategy: "REGION_SLOT" },
      },
    });
  });
});

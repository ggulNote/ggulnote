import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
  SpatialProtection,
  SpatialSceneObject,
  SpatialSceneSnapshot,
} from "../domain";
import {
  dedupePlacementCandidates,
  generatePlacementCandidates,
  resolveDeterministically,
} from "./placement-candidate-engine";

function sceneObject(
  id: string,
  bounds: Rect,
  protection: SpatialProtection = "HARD",
  sourceLayer: SpatialSceneObject["sourceLayer"] = "PDF_BASE",
): SpatialSceneObject {
  return {
    id,
    kind: sourceLayer === "PDF_BASE" ? "image" : "text",
    bounds,
    renderBounds: bounds,
    sourceLayer,
    semanticRole: sourceLayer === "PDF_BASE" ? "FIGURE" : "TEXT",
    protection,
    visible: protection !== "IGNORE",
    locked: sourceLayer === "PDF_BASE",
  };
}

function snapshot(options: {
  mode?: SpatialSceneSnapshot["mode"];
  width?: number;
  height?: number;
  objects?: readonly SpatialSceneObject[];
  viewportBounds?: Rect;
} = {}): SpatialSceneSnapshot {
  const width = options.width ?? 400;
  const height = options.height ?? 320;
  return {
    snapshotId: "spatial:page-1:7:100",
    pageId: "page-1",
    sceneRevision: 7,
    mode: options.mode ?? "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width, height },
    editableBounds: { x: 0, y: 0, width, height },
    viewportBounds: options.viewportBounds ?? { x: 0, y: 0, width, height },
    objects: options.objects ?? [],
    capturedAt: 100,
  };
}

function profile(
  overrides: Partial<PlacementProfile> = {},
): PlacementProfile {
  return {
    capability: "text",
    preferredSize: { width: 50, height: 30 },
    minSize: { width: 20, height: 20 },
    compactSize: { width: 40, height: 24 },
    resizePolicy: "COMPACT_ONCE",
    minClearance: 10,
    allowedRelations: [
      "AT",
      "INSIDE",
      "ABOVE",
      "BELOW",
      "LEFT_OF",
      "RIGHT_OF",
      "NEAR",
      "FREE_SPACE",
    ],
    overlayPolicy: "EXPLICIT_ONLY",
    overflowPolicy: "FAIL",
    ...overrides,
  };
}

function draft(
  preferredFootprint = { width: 50, height: 30 },
  compactFootprint: MeasuredDraft["compactFootprint"] = { width: 40, height: 24 },
): MeasuredDraft {
  return {
    draftKey: "draft-note-1",
    capability: "text",
    kind: "NOTE",
    preferredFootprint,
    ...(compactFootprint === undefined ? {} : { compactFootprint }),
    measurementSource: "RENDERER",
  };
}

function query(
  relation: SpatialPlacementRelation,
  overrides: Partial<SpatialPlacementQuery> = {},
): SpatialPlacementQuery {
  return {
    reference: {
      kind: "TARGET",
      query: { kind: "object", objectType: "image", query: "이 그림" },
    },
    relation,
    ...overrides,
  };
}

function anchor(
  bounds: Rect = { x: 100, y: 100, width: 100, height: 50 },
): ResolvedSpatialAnchor {
  return {
    kind: "OBJECT",
    objectId: "anchor-1",
    bounds,
    semanticRole: "FIGURE",
  };
}

function generate(options: {
  scene?: SpatialSceneSnapshot;
  placementQuery?: SpatialPlacementQuery;
  placementProfile?: PlacementProfile;
  measuredDraft?: MeasuredDraft;
  resolvedAnchor?: ResolvedSpatialAnchor;
}) {
  const resolvedAnchor = Object.hasOwn(options, "resolvedAnchor")
    ? options.resolvedAnchor
    : anchor();
  const scene = options.scene ?? snapshot({
    objects: resolvedAnchor === undefined
      ? []
      : [sceneObject("anchor-1", resolvedAnchor.bounds)],
  });
  return generatePlacementCandidates({
    snapshot: scene,
    query: options.placementQuery ?? query("BELOW", { alignment: "START" }),
    profile: options.placementProfile ?? profile(),
    draft: options.measuredDraft ?? draft(),
    anchor: resolvedAnchor,
  });
}

describe("anchor-relative placement candidates", () => {
  it("resolves one explicit below slot without a visual judge", () => {
    const placementQuery = query("BELOW", { alignment: "START" });
    const scene = snapshot({ objects: [sceneObject("anchor-1", anchor().bounds)] });
    const result = generate({ scene, placementQuery });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      alias: "S1",
      strategy: "ANCHOR_RELATIVE",
      relation: "BELOW",
      alignment: "START",
      sizeVariant: "PREFERRED",
      bounds: { x: 100, y: 160, width: 50, height: 30 },
      evidence: {
        hardOverlapArea: 0,
        relationSatisfied: true,
        insideEditableBounds: true,
      },
    });
    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: result.candidates,
      anchor: anchor(),
    }).status).toBe("RESOLVED");
  });

  it("keeps start, center, and end trade-offs ambiguous for AUTO", () => {
    const placementQuery = query("BELOW", { alignment: "AUTO" });
    const scene = snapshot({ objects: [sceneObject("anchor-1", anchor().bounds)] });
    const result = generate({ scene, placementQuery });

    expect(result.candidates.map((candidate) => candidate.alignment)).toEqual([
      "START",
      "CENTER",
      "END",
    ]);
    expect(result.candidates).toHaveLength(3);
    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: result.candidates,
      anchor: anchor(),
    })).toMatchObject({ status: "AMBIGUOUS" });
  });

  it("shifts past a HARD collision using a bounded object edge event", () => {
    const scene = snapshot({ objects: [
      sceneObject("anchor-1", anchor().bounds),
      sceneObject("blocking-text", { x: 100, y: 160, width: 50, height: 30 }),
    ] });
    const result = generate({ scene });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.bounds).toEqual({
      x: 100,
      y: 200,
      width: 50,
      height: 30,
    });
    expect(result.candidates[0]?.evidence.nearbyObjectIds).toContain("blocking-text");
  });

  it("supports above, left, right, and representative near slots", () => {
    const relations = ["ABOVE", "LEFT_OF", "RIGHT_OF"] as const;
    for (const relation of relations) {
      const result = generate({
        placementQuery: query(relation, { alignment: "CENTER" }),
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.relation).toBe(relation);
      expect(result.candidates[0]?.evidence.relationSatisfied).toBe(true);
    }

    const near = generate({ placementQuery: query("NEAR") });
    expect(near.candidates.length).toBeGreaterThan(1);
    expect(near.candidates.every((candidate) => candidate.relation === "NEAR")).toBe(true);
  });

  it("requires planner intent and profile permission for object overlay", () => {
    const overlayAnchor = anchor({ x: 100, y: 100, width: 120, height: 100 });
    const scene = snapshot({
      objects: [sceneObject("anchor-1", overlayAnchor.bounds)],
    });
    expect(generate({
      scene,
      resolvedAnchor: overlayAnchor,
      placementQuery: query("INSIDE", { alignment: "CENTER" }),
    }).candidates).toHaveLength(0);

    const explicit = generate({
      scene,
      resolvedAnchor: overlayAnchor,
      placementQuery: query("INSIDE", {
        alignment: "CENTER",
        overlayIntent: "EXPLICIT",
      }),
    });
    expect(explicit.candidates).toHaveLength(1);
    expect(explicit.candidates[0]?.bounds).toEqual({
      x: 135,
      y: 135,
      width: 50,
      height: 30,
    });

    const at = generate({
      scene,
      resolvedAnchor: overlayAnchor,
      placementQuery: query("AT", {
        alignment: "CENTER",
        overlayIntent: "EXPLICIT",
      }),
    });
    expect(at.candidates).toHaveLength(1);
    expect(at.candidates[0]?.relation).toBe("AT");
  });
});

describe("hard filter and footprint policy", () => {
  it("returns NO_FEASIBLE_PLACEMENT when the editable page is full", () => {
    const scene = snapshot({ objects: [
      sceneObject("full-page", { x: 0, y: 0, width: 400, height: 320 }),
      sceneObject("anchor-1", anchor().bounds),
    ] });
    const placementQuery = query("BELOW", { alignment: "START" });
    const result = generate({ scene, placementQuery });

    expect(result.candidates).toHaveLength(0);
    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: result.candidates,
      anchor: anchor(),
    })).toMatchObject({ status: "NO_FEASIBLE_PLACEMENT" });
  });

  it("uses compact exactly once only when preferred cannot fit", () => {
    const smallAnchor = anchor({ x: 40, y: 20, width: 80, height: 40 });
    const scene = snapshot({
      width: 160,
      height: 200,
      objects: [sceneObject("anchor-1", smallAnchor.bounds)],
    });
    const measured = draft(
      { width: 180, height: 80 },
      { width: 80, height: 40 },
    );
    const compact = generate({
      scene,
      resolvedAnchor: smallAnchor,
      measuredDraft: measured,
      placementProfile: profile({
        preferredSize: { width: 180, height: 80 },
        compactSize: { width: 80, height: 40 },
      }),
    });

    expect(compact.candidates).toHaveLength(1);
    expect(compact.candidates[0]?.sizeVariant).toBe("COMPACT");
    expect(compact.diagnostics.footprintTierAttempted).toEqual([
      "PREFERRED",
      "COMPACT",
    ]);

    const fixed = generate({
      scene,
      resolvedAnchor: smallAnchor,
      measuredDraft: measured,
      placementProfile: profile({
        preferredSize: { width: 180, height: 80 },
        compactSize: { width: 80, height: 40 },
        resizePolicy: "FIXED",
      }),
    });
    expect(fixed.candidates).toHaveLength(0);
    expect(fixed.diagnostics.footprintTierAttempted).toEqual(["PREFERRED"]);
  });

  it("keeps SOFT overlap as evidence instead of filtering it", () => {
    const scene = snapshot({ objects: [
      sceneObject("anchor-1", anchor().bounds),
      sceneObject(
        "highlight-1",
        { x: 100, y: 160, width: 50, height: 30 },
        "SOFT",
        "ANNOTATION",
      ),
    ] });
    const result = generate({ scene });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.evidence.hardOverlapArea).toBe(0);
    expect(result.candidates[0]?.evidence.softOverlapArea).toBe(1_500);
  });

  it.each([
    { width: Number.NaN, height: 30 },
    { width: Number.POSITIVE_INFINITY, height: 30 },
    { width: -10, height: 30 },
    { width: 1_000, height: 1_000 },
  ])("rejects invalid or out-of-bounds footprint %o without clamping", (footprint) => {
    const result = generate({
      measuredDraft: draft(footprint, undefined),
      placementProfile: profile({ resizePolicy: "FIXED" }),
    });
    expect(result.candidates).toHaveLength(0);
  });
});

describe("free-space, region, and common scene behavior", () => {
  it("builds coarse object-edge free-space candidates with a maximum of six", () => {
    const scene = snapshot({ objects: [
      sceneObject("left-block", { x: 0, y: 80, width: 120, height: 80 }),
      sceneObject("right-block", { x: 240, y: 160, width: 160, height: 80 }),
    ] });
    const result = generate({
      scene,
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", {
        reference: { kind: "PAGE" },
      }),
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(6);
    expect(result.candidates.every((candidate) =>
      candidate.strategy === "FREE_SPACE"
      && candidate.evidence.hardOverlapArea === 0,
    )).toBe(true);
    expect(result.candidates.map((candidate) => candidate.strategy))
      .not.toContain("OVERFLOW");
    expect(result.diagnostics.rawCandidateCount).toBeGreaterThan(
      result.candidates.length,
    );
  });

  it("uses RIGHT and CURRENT_VIEW hints as deterministic search regions", () => {
    const right = generate({
      scene: snapshot(),
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", {
        reference: { kind: "PAGE" },
        regionHint: "RIGHT",
      }),
    });
    expect(right.candidates.every((candidate) =>
      candidate.strategy === "REGION_SLOT"
      && candidate.evidence.regionMatch,
    )).toBe(true);

    const currentView = generate({
      scene: snapshot({
        viewportBounds: { x: 100, y: 80, width: 200, height: 160 },
      }),
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", {
        reference: { kind: "VIEWPORT" },
        regionHint: "CURRENT_VIEW",
      }),
    });
    expect(currentView.candidates.every((candidate) =>
      candidate.evidence.regionMatch,
    )).toBe(true);
  });

  it.each([
    "TOP",
    "BOTTOM",
    "LEFT",
    "RIGHT",
    "MARGIN",
    "CURRENT_VIEW",
  ] as const)("supports the %s region hint without planner coordinates", (regionHint) => {
    const scene = snapshot({
      viewportBounds: { x: 40, y: 40, width: 320, height: 240 },
    });
    const result = generate({
      scene,
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", {
        reference: regionHint === "CURRENT_VIEW"
          ? { kind: "VIEWPORT" }
          : { kind: "PAGE" },
        regionHint,
      }),
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) =>
      candidate.strategy === "REGION_SLOT"
      && candidate.evidence.regionMatch,
    )).toBe(true);
  });

  it("finds a paragraph right margin and a two-column gap from object edges", () => {
    const paragraphMargin = generate({
      scene: snapshot({
        objects: [sceneObject(
          "paragraph-1",
          { x: 0, y: 0, width: 250, height: 320 },
        )],
      }),
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", {
        reference: { kind: "PAGE" },
        regionHint: "RIGHT",
      }),
    });
    expect(paragraphMargin.candidates.some((candidate) =>
      candidate.bounds.x >= 260,
    )).toBe(true);

    const twoColumn = generate({
      scene: snapshot({ objects: [
        sceneObject("column-left", { x: 20, y: 20, width: 140, height: 250 }),
        sceneObject("column-right", { x: 220, y: 20, width: 140, height: 250 }),
      ] }),
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", { reference: { kind: "PAGE" } }),
      measuredDraft: draft({ width: 40, height: 30 }),
    });
    expect(twoColumn.candidates.some((candidate) =>
      candidate.bounds.x === 170,
    )).toBe(true);
  });

  it("uses identical geometry policy for PDF and blank canvas snapshots", () => {
    const bounds = anchor().bounds;
    const pdf = generate({
      scene: snapshot({
        mode: "PDF",
        objects: [sceneObject("anchor-1", bounds, "HARD", "PDF_BASE")],
      }),
    });
    const canvas = generate({
      scene: snapshot({
        mode: "BLANK",
        objects: [sceneObject("anchor-1", bounds, "HARD", "CANVAS")],
      }),
    });

    expect(pdf.candidates.map((candidate) => candidate.bounds)).toEqual(
      canvas.candidates.map((candidate) => candidate.bounds),
    );
  });

  it("returns no candidate for a densely occupied blank canvas", () => {
    const result = generate({
      scene: snapshot({
        mode: "BLANK",
        objects: [sceneObject(
          "canvas-full",
          { x: 0, y: 0, width: 400, height: 320 },
          "HARD",
          "CANVAS",
        )],
      }),
      resolvedAnchor: undefined,
      placementQuery: query("FREE_SPACE", { reference: { kind: "PAGE" } }),
    });
    expect(result.candidates).toHaveLength(0);
  });

  it("is independent from extraneous zoom and DPR metadata", () => {
    const base = snapshot({ objects: [sceneObject("anchor-1", anchor().bounds)] });
    const zoomed = {
      ...base,
      zoom: 3,
      devicePixelRatio: 2,
    } as SpatialSceneSnapshot;

    expect(generate({ scene: base }).candidates).toEqual(
      generate({ scene: zoomed }).candidates,
    );
  });
});

describe("dedupe, diversity, dominance, and determinism", () => {
  it("dedupes canonical near-identical rectangles from different paths", () => {
    const base = generate({}).candidates[0];
    if (base === undefined) throw new Error("Expected a fixture candidate.");
    const duplicate: PlacementCandidate = {
      ...base,
      internalId: `${base.internalId}:duplicate`,
      alias: "S2",
      strategy: "FREE_SPACE",
      bounds: { ...base.bounds, x: base.bounds.x + 0.0000001 },
    };
    const result = dedupePlacementCandidates([base, duplicate]);

    expect(result).toHaveLength(1);
    expect(result[0]?.alias).toBe("S1");
  });

  it("preserves diverse candidates but caps and aliases them deterministically", () => {
    const scene = snapshot();
    const placementQuery = query("FREE_SPACE", { reference: { kind: "PAGE" } });
    const first = generate({ scene, resolvedAnchor: undefined, placementQuery });
    const second = generate({ scene, resolvedAnchor: undefined, placementQuery });

    expect(first.candidates).toHaveLength(6);
    expect(first.candidates.map((candidate) => candidate.alias)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
    ]);
    expect(first).toEqual(second);
    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: first.candidates,
    }).status).toBe("AMBIGUOUS");
  });

  it("resolves only a candidate that conservatively dominates every alternative", () => {
    const scene = snapshot();
    const placementQuery = query("FREE_SPACE", { reference: { kind: "PAGE" } });
    const generated = generate({
      scene,
      resolvedAnchor: undefined,
      placementQuery,
    }).candidates;
    const first = generated[0];
    const second = generated[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two fixture candidates.");
    }
    const dominated: PlacementCandidate = {
      ...second,
      evidence: {
        ...second.evidence,
        preferredSizePreserved: false,
        softOverlapArea: first.evidence.softOverlapArea + 10,
        clearance: Math.max(0, first.evidence.clearance - 10),
        anchorDistance: first.evidence.anchorDistance + 10,
      },
    };

    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: [first, dominated],
    })).toMatchObject({
      status: "RESOLVED",
      source: "DETERMINISTIC",
      placement: { candidate: { internalId: first.internalId } },
    });
  });

  it("rejects candidates from another frozen scene revision", () => {
    const scene = snapshot();
    const placementQuery = query("FREE_SPACE", { reference: { kind: "PAGE" } });
    const candidate = generate({
      scene,
      resolvedAnchor: undefined,
      placementQuery,
    }).candidates[0];
    if (candidate === undefined) throw new Error("Expected a fixture candidate.");

    expect(resolveDeterministically({
      snapshot: scene,
      query: placementQuery,
      candidates: [{ ...candidate, sceneRevision: 8 }],
    })).toMatchObject({ status: "STALE_SCENE" });
  });

  it("has no provider call surface and does not mutate scene or editor-like state", () => {
    const scene = snapshot({ objects: [sceneObject("anchor-1", anchor().bounds)] });
    const before = structuredClone(scene);
    const editorState = { operations: 0, undoDepth: 0, indexedDbWrites: 0 };
    const aiProvider = { calls: 0 };

    const result = generate({ scene });
    resolveDeterministically({
      snapshot: scene,
      query: query("BELOW", { alignment: "START" }),
      candidates: result.candidates,
      anchor: anchor(),
    });

    expect(scene).toEqual(before);
    expect(editorState).toEqual({ operations: 0, undoDepth: 0, indexedDbWrites: 0 });
    expect(aiProvider.calls).toBe(0);
    expect(() => JSON.stringify(result.diagnostics)).not.toThrow();
  });

  it("can exclude a grounded moving subject without reading editor state", () => {
    const subjectBounds = { x: 100, y: 160, width: 50, height: 30 };
    const scene = snapshot({ objects: [
      sceneObject("anchor-1", anchor().bounds),
      sceneObject("moving-subject", subjectBounds, "HARD", "CANVAS"),
    ] });
    const result = generatePlacementCandidates({
      snapshot: scene,
      query: query("BELOW", { alignment: "START" }),
      profile: profile(),
      draft: draft(),
      anchor: anchor(),
      excludedObjectIds: ["moving-subject"],
    });

    expect(result.candidates[0]?.bounds).toEqual(subjectBounds);
  });
});

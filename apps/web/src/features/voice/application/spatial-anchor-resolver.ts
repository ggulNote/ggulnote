import type { Rect } from "@ggulnote/editor-core";
import type {
  ResolvedSpatialAnchor,
  ResolvedTarget,
  SpatialPlacementQuery,
  SpatialSceneObject,
  SpatialSceneSnapshot,
  TargetResolutionResult,
} from "../domain";
import {
  isFinitePositiveRect,
  isRectInside,
  rectBottom,
  rectRight,
} from "./spatial-occupancy-index";

export type SpatialAnchorResolutionResult =
  | {
      readonly status: "RESOLVED";
      readonly anchor: ResolvedSpatialAnchor;
    }
  | {
      readonly status: "ANCHOR_NOT_FOUND";
    }
  | {
      readonly status: "STALE_SCENE";
    };

export interface ResolveSpatialAnchorInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly targetResolution?: TargetResolutionResult;
  readonly resolvedTarget?: ResolvedTarget;
}

export function resolveSpatialAnchor(
  input: ResolveSpatialAnchorInput,
): SpatialAnchorResolutionResult {
  switch (input.query.reference.kind) {
    case "PAGE":
      return resolved({
        kind: "PAGE",
        bounds: input.snapshot.editableBounds,
      });
    case "VIEWPORT":
      return resolved({
        kind: "VIEWPORT",
        bounds: input.snapshot.viewportBounds,
      });
    case "FOCUS":
      return resolveFocusAnchor(input.snapshot);
    case "TARGET":
      return resolveTargetAnchor(
        input.snapshot,
        input.resolvedTarget
          ?? (input.targetResolution?.status === "RESOLVED"
            ? input.targetResolution.target
            : undefined),
      );
  }
}

function resolveFocusAnchor(
  snapshot: SpatialSceneSnapshot,
): SpatialAnchorResolutionResult {
  const focus = snapshot.focus;
  if (focus === undefined) return { status: "ANCHOR_NOT_FOUND" };
  const object = focus.objectId === undefined
    ? undefined
    : findObject(snapshot, focus.objectId);
  const bounds = focus.bounds ?? object?.renderBounds;
  if (bounds === undefined || !isUsableAnchorBounds(bounds, snapshot)) {
    return { status: "ANCHOR_NOT_FOUND" };
  }
  return resolved({
    kind: "FOCUS",
    ...(focus.objectId === undefined ? {} : { objectId: focus.objectId }),
    bounds,
    ...(object?.semanticRole === undefined
      ? {}
      : { semanticRole: object.semanticRole }),
    ...(object?.textPreview === undefined
      ? {}
      : { textPreview: object.textPreview }),
  });
}

function resolveTargetAnchor(
  snapshot: SpatialSceneSnapshot,
  target: ResolvedTarget | undefined,
): SpatialAnchorResolutionResult {
  if (target === undefined) {
    return { status: "ANCHOR_NOT_FOUND" };
  }
  if (
    target.pageId !== snapshot.pageId
    || target.sceneRevision !== snapshot.sceneRevision
  ) {
    return { status: "STALE_SCENE" };
  }
  const objectId = target.objectId;
  const object = objectId === undefined ? undefined : findObject(snapshot, objectId);
  const bounds = target.kind === "text_span"
    ? unionRects(target.bounds ?? []) ?? object?.renderBounds
    : object?.renderBounds ?? target.bounds;
  if (bounds === undefined || !isUsableAnchorBounds(bounds, snapshot)) {
    return { status: "ANCHOR_NOT_FOUND" };
  }
  return resolved({
    kind: "OBJECT",
    ...(objectId === undefined ? {} : { objectId }),
    bounds,
    ...(object?.semanticRole === undefined
      ? {}
      : { semanticRole: object.semanticRole }),
    ...(target.kind === "text_span"
      ? { textPreview: target.text }
      : object?.textPreview === undefined
        ? {}
        : { textPreview: object.textPreview }),
    sourceTarget: target,
  });
}

function resolved(anchor: ResolvedSpatialAnchor): SpatialAnchorResolutionResult {
  return {
    status: "RESOLVED",
    anchor: Object.freeze({
      ...anchor,
      bounds: Object.freeze({ ...anchor.bounds }),
    }),
  };
}

function findObject(
  snapshot: SpatialSceneSnapshot,
  objectId: string,
): SpatialSceneObject | undefined {
  return snapshot.objects.find((object) => object.id === objectId);
}

function isUsableAnchorBounds(
  bounds: Rect,
  snapshot: SpatialSceneSnapshot,
): boolean {
  return isFinitePositiveRect(bounds) && isRectInside(bounds, snapshot.pageBounds);
}

function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0 || rects.some((rect) => !isFinitePositiveRect(rect))) {
    return undefined;
  }
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map(rectRight));
  const bottom = Math.max(...rects.map(rectBottom));
  return { x, y, width: right - x, height: bottom - y };
}

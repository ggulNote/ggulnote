import type { Rect } from "@ggulnote/editor-core";
import type { ResolvedSpatialAnchor } from "../../domain";
import type {
  ActionTarget,
  ActionTargetFallbackPoint,
  ActionTargetRegion,
  ObjectHandle,
} from "../domain";
import type { EntityRef } from "./entity-ref";
import type { UnifiedObjectWorld } from "./unified-object-world";

export type ActionTargetGroundingMode =
  | "OBJECT"
  | "OBJECT_REGION"
  | "FALLBACK_POINT";

export interface ActionTargetHandleLookup {
  resolve(handle: string): EntityRef | undefined;
}

export interface ResolvedActionTarget {
  readonly status: "RESOLVED";
  readonly mode: ActionTargetGroundingMode;
  readonly objectHandle?: ObjectHandle;
  readonly objectRef?: EntityRef;
  readonly canvasBounds: Rect;
  readonly canvasPoint: { readonly x: number; readonly y: number };
  readonly anchor: ResolvedSpatialAnchor;
}

export type ActionTargetResolution = ResolvedActionTarget | {
  readonly status: "NOT_FOUND" | "STALE_SCENE" | "INVALID_TARGET";
  readonly reasonCode: string;
};

export interface ActionTargetResolverOptions {
  readonly world: UnifiedObjectWorld;
  readonly handles?: ActionTargetHandleLookup;
}

/** Deterministic handle lookup and normalized-coordinate transform only. */
export class ActionTargetResolver {
  public constructor(private readonly options: ActionTargetResolverOptions) {}

  public resolve(
    target: ActionTarget,
    pageId: string,
    sceneRevision: number,
  ): ActionTargetResolution {
    const scene = this.options.world.getSnapshot(pageId, sceneRevision);
    if (scene === undefined
      || scene.page.id !== pageId
      || scene.sceneRevision !== sceneRevision) {
      return { status: "STALE_SCENE", reasonCode: "STALE_SCENE" };
    }

    const objectHandle = target.object ?? undefined;
    const objectRef = objectHandle === undefined
      ? undefined
      : this.options.handles?.resolve(objectHandle);
    const objectBounds = objectRef === undefined
      ? undefined
      : boundsForRef(objectRef, this.options.world);

    if (objectRef !== undefined && objectBounds !== undefined) {
      if (target.region !== undefined && target.region !== null) {
        const canvasBounds = objectLocalRegionToCanvasBounds(objectBounds, target.region);
        if (canvasBounds === undefined) {
          return this.resolveFallback(target.fallbackPoint, objectHandle, objectRef, objectBounds, scene.page);
        }
        return resolved(
          "OBJECT_REGION",
          canvasBounds,
          center(canvasBounds),
          objectHandle,
          objectRef,
        );
      }
      return resolved(
        "OBJECT",
        objectBounds,
        center(objectBounds),
        objectHandle,
        objectRef,
      );
    }

    return this.resolveFallback(
      target.fallbackPoint,
      objectHandle,
      objectRef,
      objectBounds,
      scene.page,
    );
  }

  private resolveFallback(
    fallbackPoint: ActionTargetFallbackPoint | null | undefined,
    objectHandle: ObjectHandle | undefined,
    objectRef: EntityRef | undefined,
    objectBounds: Rect | undefined,
    page: { readonly width: number; readonly height: number },
  ): ActionTargetResolution {
    if (fallbackPoint === undefined || fallbackPoint === null) {
      return { status: "NOT_FOUND", reasonCode: "TARGET_NOT_FOUND" };
    }
    const canvasPoint = fallbackPoint.coordinateSpace === "OBJECT_LOCAL"
      ? objectBounds === undefined
        ? undefined
        : objectLocalPointToCanvasPoint(objectBounds, fallbackPoint)
      : pageNormalizedPointToCanvasPoint(page, fallbackPoint);
    if (canvasPoint === undefined) {
      return { status: "NOT_FOUND", reasonCode: "FALLBACK_REFERENCE_NOT_FOUND" };
    }
    const canvasBounds = pointBounds(canvasPoint, page);
    return {
      ...resolved(
        "FALLBACK_POINT",
        canvasBounds,
        canvasPoint,
        objectHandle,
        objectRef,
      ),
      anchor: {
        kind: fallbackPoint.coordinateSpace === "PAGE" ? "PAGE" : "OBJECT",
        ...(objectIdForRef(objectRef) === undefined
          ? {}
          : { objectId: objectIdForRef(objectRef) }),
        bounds: canvasBounds,
      },
    };
  }
}

export function objectLocalRegionToCanvasBounds(
  objectBounds: Rect,
  region: ActionTargetRegion,
): Rect | undefined {
  if (!validRect(objectBounds)
    || !unit(region.x)
    || !unit(region.y)
    || !positiveUnit(region.width)
    || !positiveUnit(region.height)
    || region.x + region.width > 1
    || region.y + region.height > 1) return undefined;
  return {
    x: objectBounds.x + objectBounds.width * region.x,
    y: objectBounds.y + objectBounds.height * region.y,
    width: objectBounds.width * region.width,
    height: objectBounds.height * region.height,
  };
}

export function objectLocalPointToCanvasPoint(
  objectBounds: Rect,
  point: Pick<ActionTargetFallbackPoint, "x" | "y">,
): { readonly x: number; readonly y: number } | undefined {
  if (!validRect(objectBounds) || !unit(point.x) || !unit(point.y)) return undefined;
  return {
    x: objectBounds.x + objectBounds.width * point.x,
    y: objectBounds.y + objectBounds.height * point.y,
  };
}

export function pageNormalizedPointToCanvasPoint(
  page: { readonly width: number; readonly height: number },
  point: Pick<ActionTargetFallbackPoint, "x" | "y">,
): { readonly x: number; readonly y: number } | undefined {
  if (!Number.isFinite(page.width) || page.width <= 0
    || !Number.isFinite(page.height) || page.height <= 0
    || !unit(point.x) || !unit(point.y)) return undefined;
  return { x: page.width * point.x, y: page.height * point.y };
}

function resolved(
  mode: ActionTargetGroundingMode,
  canvasBounds: Rect,
  canvasPoint: { readonly x: number; readonly y: number },
  objectHandle?: ObjectHandle,
  objectRef?: EntityRef,
): ResolvedActionTarget {
  const objectId = objectIdForRef(objectRef);
  return {
    status: "RESOLVED",
    mode,
    ...(objectHandle === undefined ? {} : { objectHandle }),
    ...(objectRef === undefined ? {} : { objectRef }),
    canvasBounds: { ...canvasBounds },
    canvasPoint: { ...canvasPoint },
    anchor: {
      kind: "OBJECT",
      ...(objectId === undefined ? {} : { objectId }),
      bounds: { ...canvasBounds },
    },
  };
}

function boundsForRef(ref: EntityRef, world: UnifiedObjectWorld): Rect | undefined {
  if (ref.kind === "OBJECT") return cloneRect(world.getObjectMetadata(ref.objectId)?.renderBounds);
  if (ref.kind === "OBJECT_PART") {
    return cloneRect(ref.bounds ?? world.getObjectMetadata(ref.objectId)?.renderBounds);
  }
  if (ref.kind === "TEXT_RANGE") return unionRects(ref.rects);
  return undefined;
}

function objectIdForRef(ref: EntityRef | undefined): string | undefined {
  if (ref?.kind === "OBJECT" || ref?.kind === "OBJECT_PART") return ref.objectId;
  return ref?.kind === "TEXT_RANGE" ? ref.objectIds[0] : undefined;
}

function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0 || rects.some((rect) => !validRect(rect))) return undefined;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function pointBounds(
  point: { readonly x: number; readonly y: number },
  page: { readonly width: number; readonly height: number },
): Rect {
  const size = Math.max(1, Math.min(page.width, page.height) / 1_000);
  return {
    x: Math.max(0, Math.min(page.width - size, point.x - size / 2)),
    y: Math.max(0, Math.min(page.height - size, point.y - size / 2)),
    width: size,
    height: size,
  };
}

function center(bounds: Rect): { readonly x: number; readonly y: number } {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function cloneRect(rect: Rect | undefined): Rect | undefined {
  return rect === undefined || !validRect(rect) ? undefined : { ...rect };
}

function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0;
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function positiveUnit(value: number): boolean {
  return unit(value) && value > 0;
}

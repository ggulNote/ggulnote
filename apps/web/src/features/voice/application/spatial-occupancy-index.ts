import type { Rect } from "@ggulnote/editor-core";
import type {
  SpatialSceneObject,
  SpatialSceneSnapshot,
} from "../domain";

export const SPATIAL_GEOMETRY_EPSILON = 1e-6;

export interface SpatialOccupancyIndex {
  readonly editableBounds: Rect;
  readonly hardObjects: readonly SpatialSceneObject[];
  readonly softObjects: readonly SpatialSceneObject[];
  isInsideEditableBounds(bounds: Rect): boolean;
  intersectsHard(bounds: Rect): boolean;
  violatesHardClearance(bounds: Rect): boolean;
  hardOverlapArea(bounds: Rect): number;
  softOverlapArea(bounds: Rect): number;
  clearance(bounds: Rect): number;
  nearby(bounds: Rect, limit: number): readonly SpatialSceneObject[];
  blockingHardObjects(bounds: Rect): readonly SpatialSceneObject[];
}

export interface RectSpatialOccupancyIndexOptions {
  readonly snapshot: SpatialSceneSnapshot;
  readonly minimumClearance: number;
  readonly excludedObjectIds?: readonly SpatialSceneObject["id"][];
}

export class RectSpatialOccupancyIndex implements SpatialOccupancyIndex {
  public readonly editableBounds: Rect;
  public readonly hardObjects: readonly SpatialSceneObject[];
  public readonly softObjects: readonly SpatialSceneObject[];
  private readonly consideredObjects: readonly SpatialSceneObject[];
  private readonly minimumClearance: number;

  public constructor(options: RectSpatialOccupancyIndexOptions) {
    const excluded = new Set(options.excludedObjectIds ?? []);
    this.minimumClearance = isFiniteNonNegative(options.minimumClearance)
      ? options.minimumClearance
      : Number.NaN;
    this.editableBounds = copyRect(options.snapshot.editableBounds);
    this.hardObjects = Object.freeze(options.snapshot.objects.filter(
      (object) => object.protection === "HARD" && !excluded.has(object.id),
    ));
    this.softObjects = Object.freeze(options.snapshot.objects.filter(
      (object) => object.protection === "SOFT" && !excluded.has(object.id),
    ));
    this.consideredObjects = Object.freeze([
      ...this.hardObjects,
      ...this.softObjects,
    ]);
  }

  public isInsideEditableBounds(bounds: Rect): boolean {
    return isFinitePositiveRect(bounds)
      && isRectInside(bounds, this.editableBounds);
  }

  public intersectsHard(bounds: Rect): boolean {
    return this.hardOverlapArea(bounds) > 0;
  }

  public violatesHardClearance(bounds: Rect): boolean {
    if (!isFinitePositiveRect(bounds) || !isFiniteNonNegative(this.minimumClearance)) {
      return true;
    }
    return this.blockingHardObjects(bounds).length > 0;
  }

  public hardOverlapArea(bounds: Rect): number {
    return totalIntersectionArea(bounds, this.hardObjects);
  }

  public softOverlapArea(bounds: Rect): number {
    return totalIntersectionArea(bounds, this.softObjects);
  }

  public clearance(bounds: Rect): number {
    if (!isFinitePositiveRect(bounds)) return 0;
    if (this.hardObjects.length === 0) {
      return Math.hypot(
        this.editableBounds.width,
        this.editableBounds.height,
      );
    }
    return Math.min(...this.hardObjects.map((object) =>
      rectDistance(bounds, object.renderBounds),
    ));
  }

  public nearby(
    bounds: Rect,
    limit: number,
  ): readonly SpatialSceneObject[] {
    if (!isFinitePositiveRect(bounds) || !Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    return [...this.consideredObjects]
      .sort((left, right) => {
        const distanceDelta = rectDistance(bounds, left.renderBounds)
          - rectDistance(bounds, right.renderBounds);
        return Math.abs(distanceDelta) > SPATIAL_GEOMETRY_EPSILON
          ? distanceDelta
          : left.id.localeCompare(right.id);
      })
      .slice(0, Math.floor(limit));
  }

  public blockingHardObjects(
    bounds: Rect,
  ): readonly SpatialSceneObject[] {
    if (!isFinitePositiveRect(bounds) || !isFiniteNonNegative(this.minimumClearance)) {
      return this.hardObjects;
    }
    return this.hardObjects.filter((object) => rectsOverlap(
      bounds,
      inflateRect(object.renderBounds, this.minimumClearance),
    ));
  }
}

export function isFinitePositiveRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

export function isRectInside(inner: Rect, outer: Rect): boolean {
  return isFinitePositiveRect(inner)
    && isFinitePositiveRect(outer)
    && inner.x >= outer.x
    && inner.y >= outer.y
    && rectRight(inner) <= rectRight(outer)
    && rectBottom(inner) <= rectBottom(outer);
}

export function rectIntersectionArea(left: Rect, right: Rect): number {
  if (!isFinitePositiveRect(left) || !isFinitePositiveRect(right)) return 0;
  const width = Math.min(rectRight(left), rectRight(right))
    - Math.max(left.x, right.x);
  const height = Math.min(rectBottom(left), rectBottom(right))
    - Math.max(left.y, right.y);
  return width > 0
    && height > 0
    ? width * height
    : 0;
}

export function rectDistance(left: Rect, right: Rect): number {
  if (!isFinitePositiveRect(left) || !isFinitePositiveRect(right)) return 0;
  const horizontal = Math.max(
    0,
    Math.max(left.x, right.x) - Math.min(rectRight(left), rectRight(right)),
  );
  const vertical = Math.max(
    0,
    Math.max(left.y, right.y) - Math.min(rectBottom(left), rectBottom(right)),
  );
  return Math.hypot(horizontal, vertical);
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return rectIntersectionArea(left, right) > 0;
}

function inflateRect(rect: Rect, clearance: number): Rect {
  return {
    x: rect.x - clearance,
    y: rect.y - clearance,
    width: rect.width + clearance * 2,
    height: rect.height + clearance * 2,
  };
}

function totalIntersectionArea(
  bounds: Rect,
  objects: readonly SpatialSceneObject[],
): number {
  if (!isFinitePositiveRect(bounds)) return 0;
  return objects.reduce(
    (total, object) => total + rectIntersectionArea(bounds, object.renderBounds),
    0,
  );
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function copyRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

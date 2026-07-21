import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { isPointInRect, isPointNearRect } from "../geometry/bounds-utils";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { ShapeKind } from "./annotation-types";

export class ShapeAnnotation extends Annotation {
  public readonly type = "SHAPE" as const;

  public constructor(
    id: string,
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public shape: ShapeKind,
    public strokeWidth: number,
    public filled: boolean,
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt);
  }

  public hitTest(point: NormalizedPoint, _pageSize: Size): boolean {
    if (this.shape === "ellipse") {
      return this.hitTestEllipse(point, this.strokeWidth <= 0 ? 0.005 : this.strokeWidth / 500);
    }

    const expanded = isPointNearRect(point, this.bounds, this.strokeWidth <= 0 ? 0.003 : this.strokeWidth / 500);
    return isPointInRect(point, this.bounds) || expanded;
  }

  public translate(delta: NormalizedPoint): void {
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
  }

  public clone(): ShapeAnnotation {
    return new ShapeAnnotation(
      this.id,
      this.pageId,
      { ...this.bounds },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.shape,
      this.strokeWidth,
      this.filled,
    );
  }

  public serialize(): SerializedAnnotation {
    return {
      schemaVersion: 1,
      id: this.id,
      pageId: this.pageId,
      type: this.type,
      bounds: { ...this.bounds },
      zIndex: this.zIndex,
      properties: {
        shape: this.shape,
        strokeWidth: this.strokeWidth,
        filled: this.filled,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private hitTestEllipse(point: NormalizedPoint, tolerance: number): boolean {
    const radiusX = this.bounds.width / 2;
    const radiusY = this.bounds.height / 2;

    if (radiusX <= 0 || radiusY <= 0) {
      return false;
    }

    const cx = this.bounds.x + radiusX;
    const cy = this.bounds.y + radiusY;

    const nx = (point.x - cx) / radiusX;
    const ny = (point.y - cy) / radiusY;
    const distance = nx * nx + ny * ny;

    const expandedTolerance = Math.max(0.002, Math.min(0.05, tolerance));
    return distance <= 1 + expandedTolerance;
  }
}

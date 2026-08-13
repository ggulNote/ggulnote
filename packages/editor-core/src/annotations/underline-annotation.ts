import type { NormalizedPoint, NormalizedRect, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { isPointInRect, isPointNearRect } from "../geometry/bounds-utils";
import {
  clampAnnotationRectGroupToBounds,
  translateAnnotationRects,
  unionAnnotationRects,
} from "../geometry/multi-rect-geometry";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { AnnotationObjectMetadata } from "./annotation-types";

export class UnderlineAnnotation extends Annotation {
  public readonly type = "UNDERLINE" as const;

  public constructor(
    id: string,
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public thickness: number,
    public lineStyle: "solid" | "double" | "wavy",
    public color: string,
    public rects?: NormalizedRect[],
    objectMetadata: AnnotationObjectMetadata = {},
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt, objectMetadata);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.002, 8 / Math.max(1, Math.max(pageSize.width, pageSize.height)));
    return this.getRects().some((rect) => {
      const y = rect.y + rect.height;
      const nearLine = Math.abs(point.y - y) <= tolerance
        && point.x >= rect.x - tolerance
        && point.x <= rect.x + rect.width + tolerance;
      return nearLine || isPointInRect(point, rect) || isPointNearRect(point, rect, tolerance);
    });
  }

  public translate(delta: NormalizedPoint): void {
    if (this.rects !== undefined) {
      this.rects = translateAnnotationRects(this.rects, delta);
      this.bounds = unionAnnotationRects(this.rects);
      this.touch();
      return;
    }
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
  }

  public override clampToBounds(pageSize: Size): void {
    if (this.rects === undefined) {
      super.clampToBounds(pageSize);
      return;
    }
    this.rects = clampAnnotationRectGroupToBounds(this.rects);
    this.bounds = unionAnnotationRects(this.rects);
  }

  public getRects(): readonly NormalizedRect[] {
    return this.rects ?? [this.bounds];
  }

  public clone(): UnderlineAnnotation {
    return new UnderlineAnnotation(
      this.id,
      this.pageId,
      { ...this.bounds },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.thickness,
      this.lineStyle,
      this.color,
      this.rects?.map((rect) => ({ ...rect })),
      this.cloneObjectMetadata(),
    );
  }

  public serialize(): SerializedAnnotation {
    return {
      schemaVersion: 1,
      id: this.id,
      pageId: this.pageId,
      type: this.type,
      bounds: { ...this.bounds },
      ...(this.rects === undefined
        ? {}
        : { rects: this.rects.map((rect) => ({ ...rect })) }),
      zIndex: this.zIndex,
      properties: {
        thickness: this.thickness,
        lineStyle: this.lineStyle,
        color: this.color,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...this.serializeObjectMetadata(),
    };
  }
}

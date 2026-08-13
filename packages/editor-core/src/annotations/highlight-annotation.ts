import type { NormalizedPoint, NormalizedRect, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import {
  clampAnnotationRectGroupToBounds,
  translateAnnotationRects,
  unionAnnotationRects,
} from "../geometry/multi-rect-geometry";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import { isPointNearRect } from "../geometry/bounds-utils";
import type { AnnotationObjectMetadata } from "./annotation-types";

export class HighlightAnnotation extends Annotation {
  public readonly type = "HIGHLIGHT" as const;

  public constructor(
    id: string,
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public opacity: number,
    public color: string,
    public rects?: NormalizedRect[],
    objectMetadata: AnnotationObjectMetadata = {},
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt, objectMetadata);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.002, 6 / Math.max(1, Math.max(pageSize.width, pageSize.height)));
    return this.getRects().some((rect) => isPointNearRect(point, rect, tolerance));
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

  public clone(): HighlightAnnotation {
    return new HighlightAnnotation(
      this.id,
      this.pageId,
      { ...this.bounds },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.opacity,
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
        opacity: this.opacity,
        color: this.color,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...this.serializeObjectMetadata(),
    };
  }
}

import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translatePoint } from "../geometry/geometry-utils";
import { rectFromPoints, translateRect } from "../geometry/geometry-utils";
import { hitTestLineSegment, hitTestArrowHead } from "../geometry/hit-test";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { LineKind } from "./annotation-types";
import type { AnnotationObjectMetadata } from "./annotation-types";

export class LineAnnotation extends Annotation {
  public readonly type = "LINE" as const;

  public constructor(
    id: string,
    pageId: string,
    public start: NormalizedPoint,
    public end: NormalizedPoint,
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public lineKind: LineKind,
    public strokeWidth: number,
    public color: string,
    objectMetadata: AnnotationObjectMetadata = {},
  ) {
    super(id, pageId, rectFromPoints(start, end), zIndex, createdAt, updatedAt, objectMetadata);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.002, 10 / Math.max(1, Math.max(pageSize.width, pageSize.height)));

    if (hitTestLineSegment(point, this.start, this.end, pageSize)) {
      if (this.distanceFromSegment(point) <= tolerance) {
        return true;
      }
    }

    if (this.lineKind === "arrow") {
      return hitTestArrowHead(point, this.start, this.end, pageSize);
    }

    return this.distanceFromSegment(point) <= tolerance;
  }

  private distanceFromSegment(point: NormalizedPoint): number {
    // Lightweight duplicate for tolerance checks without rebuilding geometry twice.
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      const dpx = point.x - this.start.x;
      const dpy = point.y - this.start.y;
      return Math.hypot(dpx, dpy);
    }

    const t = ((point.x - this.start.x) * dx + (point.y - this.start.y) * dy) / lengthSquared;
    const clampedT = Math.min(1, Math.max(0, t));
    const px = this.start.x + clampedT * dx;
    const py = this.start.y + clampedT * dy;

    return Math.hypot(point.x - px, point.y - py);
  }

  public translate(delta: NormalizedPoint): void {
    this.start = translatePoint(this.start, delta);
    this.end = translatePoint(this.end, delta);
    this.bounds = rectFromPoints(this.start, this.end);
    this.touch();
  }

  public clone(): LineAnnotation {
    return new LineAnnotation(
      this.id,
      this.pageId,
      { ...this.start },
      { ...this.end },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.lineKind,
      this.strokeWidth,
      this.color,
      this.cloneObjectMetadata(),
    );
  }

  public clampToBounds(pageSize: Size): void {
    super.clampToBounds(pageSize);
    const minX = Math.min(this.start.x, this.end.x);
    const minY = Math.min(this.start.y, this.end.y);
    const deltaX = this.bounds.x - minX;
    const deltaY = this.bounds.y - minY;

    this.start = {
      x: this.start.x + deltaX,
      y: this.start.y + deltaY,
    };

    this.end = {
      x: this.end.x + deltaX,
      y: this.end.y + deltaY,
    };

    this.bounds = rectFromPoints(this.start, this.end);
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
        start: { ...this.start },
        end: { ...this.end },
        lineKind: this.lineKind,
        strokeWidth: this.strokeWidth,
        color: this.color,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...this.serializeObjectMetadata(),
    };
  }
}

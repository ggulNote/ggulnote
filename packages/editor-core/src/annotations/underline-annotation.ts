import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { isPointInRect, isPointNearRect } from "../geometry/bounds-utils";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";

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
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.002, 8 / Math.max(1, Math.max(pageSize.width, pageSize.height)));
    const y = this.bounds.y + this.bounds.height;
    const nearLine = Math.abs(point.y - y) <= tolerance && point.x >= this.bounds.x - tolerance && point.x <= this.bounds.x + this.bounds.width + tolerance;
    return nearLine || isPointInRect(point, this.bounds) || isPointNearRect(point, this.bounds, tolerance);
  }

  public translate(delta: NormalizedPoint): void {
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
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
        thickness: this.thickness,
        lineStyle: this.lineStyle,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

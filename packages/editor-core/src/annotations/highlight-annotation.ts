import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import { isPointNearRect } from "../geometry/bounds-utils";

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
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.002, 6 / Math.max(1, Math.max(pageSize.width, pageSize.height)));
    return isPointNearRect(point, this.bounds, tolerance);
  }

  public translate(delta: NormalizedPoint): void {
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
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
        opacity: this.opacity,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

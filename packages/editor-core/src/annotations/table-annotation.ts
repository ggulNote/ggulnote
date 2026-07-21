import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { isPointInRect } from "../geometry/bounds-utils";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";

export class TableAnnotation extends Annotation {
  public readonly type = "TABLE" as const;

  public constructor(
    id: string,
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public rows: number,
    public columns: number,
    public strokeColor: string,
    public strokeWidth: number,
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt);
  }

  public hitTest(point: NormalizedPoint, _pageSize: Size): boolean {
    return isPointInRect(point, this.bounds);
  }

  public translate(delta: NormalizedPoint): void {
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
  }

  public clone(): TableAnnotation {
    return new TableAnnotation(
      this.id,
      this.pageId,
      { ...this.bounds },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.rows,
      this.columns,
      this.strokeColor,
      this.strokeWidth,
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
        rows: this.rows,
        columns: this.columns,
        strokeColor: this.strokeColor,
        strokeWidth: this.strokeWidth,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

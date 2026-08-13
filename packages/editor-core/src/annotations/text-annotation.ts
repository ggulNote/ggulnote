import type { NormalizedPoint, Size } from "@ggulnote/shared-types";
import { translateRect } from "../geometry/geometry-utils";
import { isPointInRect, isPointNearRect } from "../geometry/bounds-utils";
import { Annotation } from "./annotation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { AnnotationObjectMetadata } from "./annotation-types";

export class TextAnnotation extends Annotation {
  public readonly type = "TEXT" as const;

  public constructor(
    id: string,
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
    zIndex: number,
    createdAt: number,
    updatedAt: number,
    public text: string,
    public fontSize: number,
    public textAlign: "left" | "center" | "right",
    public textColor: string,
    public textFontFamily: string,
    public textFontWeight: "normal" | "bold",
    objectMetadata: AnnotationObjectMetadata = {},
  ) {
    super(id, pageId, bounds, zIndex, createdAt, updatedAt, objectMetadata);
  }

  public hitTest(point: NormalizedPoint, pageSize: Size): boolean {
    const tolerance = Math.max(0.001, 8 / Math.max(1, Math.max(pageSize.width, pageSize.height)));
    return isPointInRect(point, this.bounds) || isPointNearRect(point, this.bounds, tolerance);
  }

  public translate(delta: NormalizedPoint): void {
    this.bounds = translateRect(this.bounds, delta);
    this.touch();
  }

  public clone(): TextAnnotation {
    return new TextAnnotation(
      this.id,
      this.pageId,
      { ...this.bounds },
      this.zIndex,
      this.createdAt,
      this.updatedAt,
      this.text,
      this.fontSize,
      this.textAlign,
      this.textColor,
      this.textFontFamily,
      this.textFontWeight,
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
      zIndex: this.zIndex,
      properties: {
        text: this.text,
        fontSize: this.fontSize,
        textAlign: this.textAlign,
        textColor: this.textColor,
        textFontFamily: this.textFontFamily,
        textFontWeight: this.textFontWeight,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...this.serializeObjectMetadata(),
    };
  }
}

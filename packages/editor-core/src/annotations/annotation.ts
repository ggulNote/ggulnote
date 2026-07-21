import type { AnnotationId, PageId } from "@ggulnote/shared-types";
import type { NormalizedPoint } from "@ggulnote/shared-types";
import type { NormalizedRect } from "@ggulnote/shared-types";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { AnnotationType } from "./annotation-types";

export abstract class Annotation {
  public abstract readonly type: AnnotationType;

  protected constructor(
    public readonly id: AnnotationId,
    public readonly pageId: PageId,
    public bounds: NormalizedRect,
    public zIndex: number,
    public readonly createdAt: number,
    public updatedAt: number,
  ) {}

  public abstract hitTest(point: NormalizedPoint, pageSize: { width: number; height: number }): boolean;

  public abstract translate(delta: NormalizedPoint): void;

  public abstract clone(): Annotation;

  public abstract serialize(): SerializedAnnotation;

  public clampToBounds(pageSize: { width: number; height: number }): void {
    const width = Number.isFinite(this.bounds.width) && this.bounds.width > 0 ? this.bounds.width : 0;
    const height = Number.isFinite(this.bounds.height) && this.bounds.height > 0 ? this.bounds.height : 0;

    const clampedWidth = Math.min(1, Math.max(0, width));
    const clampedHeight = Math.min(1, Math.max(0, height));

    let x = Number.isFinite(this.bounds.x) ? this.bounds.x : 0;
    let y = Number.isFinite(this.bounds.y) ? this.bounds.y : 0;

    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));

    if (x + clampedWidth > 1) {
      x = Math.max(0, 1 - clampedWidth);
    }

    if (y + clampedHeight > 1) {
      y = Math.max(0, 1 - clampedHeight);
    }

    this.bounds = {
      x,
      y,
      width: clampedWidth,
      height: clampedHeight,
    };
  }

  protected touch(): void {
    this.updatedAt = Date.now();
  }
}

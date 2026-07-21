import type { AnnotationId, PageId } from "@ggulnote/shared-types";
import type { Size } from "@ggulnote/shared-types";
import type { Annotation } from "../annotations/annotation";

const isFiniteSize = (value: number): boolean => Number.isFinite(value) && value > 0;
const isFinitePoint = (value: number): boolean => Number.isFinite(value);

export class PageScene {
  private readonly annotations = new Map<AnnotationId, Annotation>();

  public constructor(public readonly pageId: PageId) {}

  public add(annotation: Annotation): void {
    if (this.annotations.has(annotation.id)) {
      throw new Error(`Duplicate annotation id: ${annotation.id}`);
    }

    this.annotations.set(annotation.id, annotation);
  }

  public clear(): void {
    this.annotations.clear();
  }

  public replace(annotations: Iterable<Annotation>): void {
    this.clear();
    for (const annotation of annotations) {
      this.annotations.set(annotation.id, annotation);
    }
  }

  public remove(annotationId: AnnotationId): Annotation | null {
    const annotation = this.annotations.get(annotationId);
    if (!annotation) {
      return null;
    }

    this.annotations.delete(annotationId);
    return annotation;
  }

  public get(annotationId: AnnotationId): Annotation | null {
    return this.annotations.get(annotationId) ?? null;
  }

  public getAll(): readonly Annotation[] {
    return [...this.annotations.values()].sort((left, right) => {
      if (left.zIndex === right.zIndex) {
        return left.id.localeCompare(right.id);
      }

      return left.zIndex - right.zIndex;
    });
  }

  public update(annotation: Annotation): void {
    if (!this.annotations.has(annotation.id)) {
      throw new Error(`Annotation not found: ${annotation.id}`);
    }

    this.annotations.set(annotation.id, annotation);
  }

  public hitTest(point: { x: number; y: number }, pageSize?: Size): Annotation | null {
    const normalized = {
      x: isFinitePoint(point.x) ? point.x : 0,
      y: isFinitePoint(point.y) ? point.y : 0,
    };

    const resolvedPageSize: Size =
      pageSize && isFiniteSize(pageSize.width) && isFiniteSize(pageSize.height)
        ? pageSize
        : { width: 1, height: 1 };

    const sorted = this.getAll();
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const annotation = sorted[index];
      if (annotation.hitTest(normalized, resolvedPageSize)) {
        return annotation;
      }
    }

    return null;
  }

  public count(): number {
    return this.annotations.size;
  }
}

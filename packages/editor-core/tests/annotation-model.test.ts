import { describe, expect, it } from "vitest";
import { type Annotation, type CreateAnnotationInput } from "../src";
import { AnnotationFactory } from "../src/annotations/annotation-factory";
import { deserializeAnnotation } from "../src/serialization/annotation-serializer";

const createFactory = () => {
  let id = 0;
  return new AnnotationFactory({
    idGenerator: () => `annotation-${++id}`,
    now: () => 1_700_000_000_000,
  });
};

const makePageId = "test-page";

describe("AnnotationFactory", () => {
  it("creates default text annotation values", () => {
    const factory = createFactory();

    const annotation = factory.create({
      type: "TEXT",
      pageId: makePageId,
      bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.1 },
      text: "   ",
    });

    expect(annotation.type).toBe("TEXT");
    expect(annotation.id).toBe("annotation-1");
    expect((annotation as Extract<Annotation, { type: "TEXT" }>).text).toBe("memo");
    expect((annotation as Extract<Annotation, { type: "TEXT" }>).fontSize).toBe(14);
    expect(annotation.pageId).toBe(makePageId);
  });

  it("validates table input range", () => {
    const factory = createFactory();

    expect(() =>
      factory.create({
        type: "TABLE",
        pageId: makePageId,
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        rows: 0,
        columns: 5,
      }),
    ).toThrow("Invalid rows");

    expect(() =>
      factory.create({
        type: "TABLE",
        pageId: makePageId,
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        rows: 2,
        columns: 25,
      }),
    ).toThrow("Invalid columns");
  });

  it("clamps bounds to normalized range", () => {
    const factory = createFactory();

    const annotation = factory.create({
      type: "SHAPE",
      pageId: makePageId,
      bounds: { x: 1.2, y: -0.5, width: 0.2, height: 0.2 },
      shape: "ellipse",
    });

    expect(annotation.bounds.x).toBe(0.8);
    expect(annotation.bounds.y).toBe(0);
  });
});

describe("Annotation behavior", () => {
  it("translates and serializes without losing type", () => {
    const factory = createFactory();
    const input: CreateAnnotationInput = {
      type: "HIGHLIGHT",
      pageId: makePageId,
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
    };

    const annotation = factory.create(input);
    annotation.translate({ x: 0.2, y: 0.1 });
    const serialized = annotation.serialize();
    const restored = deserializeAnnotation(serialized);

    expect(restored.type).toBe("HIGHLIGHT");
    expect(restored.bounds).toEqual({ x: 0.30000000000000004, y: 0.30000000000000004, width: 0.3, height: 0.05 });
    expect(restored.serialize()).toMatchObject({
      type: "HIGHLIGHT",
      properties: {
        opacity: 0.35,
      },
    });
  });

  it("moves line annotations and preserves start/end", () => {
    const factory = createFactory();

    const annotation = factory.create({
      type: "LINE",
      pageId: makePageId,
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.3, y: 0.1 },
      lineKind: "arrow",
    });

    annotation.translate({ x: 0.1, y: 0.2 });

    if (annotation.type !== "LINE") {
      throw new Error("Unexpected annotation type");
    }

    expect(annotation.start).toEqual({ x: 0.2, y: 0.30000000000000004 });
    expect(annotation.end).toEqual({ x: 0.4, y: 0.30000000000000004 });
    expect(annotation.bounds).toEqual({ x: 0.2, y: 0.30000000000000004, width: 0.2, height: 0 });
  });
});

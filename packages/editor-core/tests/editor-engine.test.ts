import { describe, expect, it } from "vitest";
import { type AnnotationRenderer, EditorEngine, type SerializedAnnotation } from "../src";
import type { NormalizedPoint } from "../src";

const createEngine = (): EditorEngine => {
  const engine = new EditorEngine({
    historyLimit: 10,
    idGenerator: (() => {
      let seq = 0;
      return () => `ann-${++seq}`;
    })(),
  });

  engine.setDocument("doc-1");
  engine.setActivePage("doc-1-page-1", { width: 1000, height: 1000 });
  return engine;
};

describe("EditorEngine", () => {
  it("creates, selects, moves and deletes annotation", () => {
    const engine = createEngine();

    const annotationId = engine.createAnnotation({
      type: "TEXT",
      pageId: "doc-1-page-1",
      bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.08 },
      text: "memo",
    });

    const selected = engine.selectAt({ x: 0.11, y: 0.11 });
    expect(selected).toBe(annotationId);

    const start = engine.getSelectedAnnotationSnapshot() as SerializedAnnotation;
    engine.moveSelected({ x: 0.1, y: 0.1 });
    const moved = engine.getSelectedAnnotationSnapshot() as SerializedAnnotation;
    expect(moved.bounds.x).toBeGreaterThan(start.bounds.x);

    engine.undo();
    const restored = engine.getSelectedAnnotationSnapshot() as SerializedAnnotation;
    expect(restored.bounds).toEqual(start.bounds);

    engine.deleteSelected();
    expect(engine.getSnapshot().annotationCount).toBe(0);

    engine.undo();
    expect(engine.getSnapshot().annotationCount).toBe(1);
  });

  it("keeps annotation per page and restores on page revisit", () => {
    const engine = createEngine();

    const firstId = engine.createAnnotation({
      type: "TEXT",
      pageId: "doc-1-page-1",
      bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      text: "page1",
    });
    engine.setActivePage("doc-1-page-2", { width: 1000, height: 1000 });

    const secondId = engine.createAnnotation({
      type: "TEXT",
      pageId: "doc-1-page-2",
      bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 },
      text: "page2",
    });

    engine.setActivePage("doc-1-page-1", { width: 1000, height: 1000 });

    expect(engine.getSnapshot().annotationCount).toBe(2);
    const selected = engine.selectAt({ x: 0.21, y: 0.21 });
    expect(selected).toBe(firstId);

    engine.setActivePage("doc-1-page-2", { width: 1000, height: 1000 });
    expect(engine.getSnapshot().annotationCount).toBe(2);
    expect(engine.selectAt({ x: 0.31, y: 0.31 })).toBe(secondId);
  });

  it("supports drag workflow and undo for full drag", () => {
    const engine = createEngine();
    const annotationId = engine.createAnnotation({
      type: "HIGHLIGHT",
      pageId: "doc-1-page-1",
      bounds: { x: 0.05, y: 0.05, width: 0.15, height: 0.1 },
    });

    engine.selectAt({ x: 0.06, y: 0.06 });
    expect(engine.getSelectedAnnotationId()).toBe(annotationId);

    const started = engine.startDrag({ x: 0.06, y: 0.06 });
    expect(started).toBe(true);

    engine.moveDrag({ x: 0.26, y: 0.22 });
    engine.commitDrag();
    const after = engine.getSelectedAnnotationSnapshot();
    expect(after?.bounds.x).toBeGreaterThan(0.05);

    engine.undo();
    const before = engine.getSelectedAnnotationSnapshot();
    expect(before?.bounds.x).toBeCloseTo(0.05);
  });

  it("renders annotations and selection through renderer contract", () => {
    const engine = createEngine();
    const annotationId = engine.createAnnotation({
      type: "SHAPE",
      pageId: "doc-1-page-1",
      bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
      shape: "rectangle",
    });

    const calls: string[] = [];
    const order: string[] = [];
    const snapshots: Array<string> = [];

    const renderer: AnnotationRenderer = {
      beginFrame: (ctx) => {
        calls.push("begin");
        expect(ctx.selectedAnnotationId).toBe(annotationId);
      },
      render: (annotation) => {
        calls.push(`render-${annotation.id}`);
        snapshots.push(JSON.stringify(annotation.serialize()));
      },
      renderSelection: (annotation) => {
        calls.push(`selection-${annotation.id}`);
      },
      endFrame: () => calls.push("end"),
    };

    engine.selectAt({ x: 0.25, y: 0.25 });
    engine.render(renderer, 2);

    expect(calls[0]).toBe("begin");
    expect(calls).toContain("render-" + annotationId);
    expect(calls).toContain("selection-" + annotationId);
    expect(calls[calls.length - 1]).toBe("end");
    expect(snapshots).toHaveLength(1);
  });

  it("notifies subscribers on state change and removes listener on destroy", () => {
    const engine = createEngine();
    let updates = 0;
    const dispose = engine.subscribe(() => {
      updates += 1;
    });

    engine.createAnnotation({
      type: "LINE",
      pageId: "doc-1-page-1",
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.2, y: 0.2 },
      lineKind: "line",
    });
    expect(updates).toBeGreaterThan(0);

    dispose();
    engine.undo();
    const afterDispose = updates;
    engine.createAnnotation({
      type: "LINE",
      pageId: "doc-1-page-1",
      start: { x: 0.3, y: 0.3 },
      end: { x: 0.4, y: 0.4 },
      lineKind: "line",
    });
    expect(updates).toBe(afterDispose);
    engine.destroy();
  });

  it("resets state when document changes", () => {
    const engine = createEngine();
    engine.createAnnotation({
      type: "TEXT",
      pageId: "doc-1-page-1",
      bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      text: "memo",
    });

    engine.setDocument("doc-2");
    expect(engine.getSnapshot().documentId).toBe("doc-2");
    expect(engine.getSnapshot().annotationCount).toBe(0);
    expect(engine.getSnapshot().activePageId).toBeNull();
  });
});


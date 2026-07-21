import { describe, expect, it } from "vitest";
import { AnnotationFactory } from "../src/annotations/annotation-factory";
import { PageScene } from "../src/scene/page-scene";
import { SceneStore } from "../src/scene/scene-store";

const pageId = "page-1";

const createScene = () => {
  const factory = new AnnotationFactory({
    idGenerator: (() => {
      let index = 0;
      return () => `ann-${++index}`;
    })(),
    now: () => 1,
  });

  const scene = new PageScene(pageId);
  return { scene, factory };
};

describe("PageScene", () => {
  it("adds, removes and retrieves annotation by id", () => {
    const { scene, factory } = createScene();
    const annotation = factory.create({
      type: "TEXT",
      pageId,
      bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      text: "memo",
    });

    scene.add(annotation);
    expect(scene.get(annotation.id)).toBe(annotation);

    const removed = scene.remove(annotation.id);
    expect(removed).toBe(annotation);
    expect(scene.get(annotation.id)).toBeNull();
  });

  it("rejects duplicate ids", () => {
    const { scene, factory } = createScene();
    const a = factory.create({
      type: "TEXT",
      pageId,
      bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
      text: "a",
    });
    const b = { ...a };
    scene.add(a);

    expect(() => scene.add(a as never)).toThrow("Duplicate annotation id");
    expect(() => scene.add(b as never)).toThrow("Duplicate annotation id");
  });

  it("sorts by zIndex for hit test order", () => {
    const { scene, factory } = createScene();

    const lower = factory.create({
      type: "UNDERLINE",
      pageId,
      bounds: { x: 0.2, y: 0.2, width: 0.4, height: 0.1 },
    });
    const upper = factory.create({
      type: "UNDERLINE",
      pageId,
      bounds: { x: 0.2, y: 0.2, width: 0.4, height: 0.1 },
    });

    lower.zIndex = 1;
    upper.zIndex = 5;
    scene.add(lower);
    scene.add(upper);

    const all = scene.getAll();
    expect(all[0]).toBe(lower);
    expect(all[1]).toBe(upper);
    expect(scene.hitTest({ x: 0.21, y: 0.21 }, { width: 1, height: 1 })?.id).toBe(upper.id);
  });
});

describe("SceneStore", () => {
  it("keeps pages isolated and removable", () => {
    const store = new SceneStore();
    const page1 = store.getOrCreatePage("page-1");
    const page2 = store.getOrCreatePage("page-2");

    expect(store.getPage("page-1")).toBe(page1);
    expect(store.getPage("page-2")).toBe(page2);
    expect(store.getPage("page-3")).toBeNull();

    store.removePage("page-1");
    expect(store.getPage("page-1")).toBeNull();
    expect(store.getPage("page-2")).toBe(page2);
    expect(store.totalAnnotationCount()).toBe(0);
  });
});


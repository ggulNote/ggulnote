import type { PageId } from "@ggulnote/shared-types";
import { PageScene } from "./page-scene";
import type { Annotation } from "../annotations/annotation";

export class SceneStore {
  private readonly scenes = new Map<PageId, PageScene>();

  public getOrCreatePage(pageId: PageId): PageScene {
    let scene = this.scenes.get(pageId);
    if (!scene) {
      scene = new PageScene(pageId);
      this.scenes.set(pageId, scene);
    }

    return scene;
  }

  public getPage(pageId: PageId): PageScene | null {
    return this.scenes.get(pageId) ?? null;
  }

  public replacePage(pageId: PageId, annotations: Iterable<Annotation>): void {
    const scene = this.getOrCreatePage(pageId);
    scene.replace(annotations);
  }

  public removePage(pageId: PageId): void {
    this.scenes.delete(pageId);
  }

  public clear(): void {
    this.scenes.clear();
  }

  public *allScenes(): IterableIterator<PageScene> {
    for (const scene of this.scenes.values()) {
      yield scene;
    }
  }

  public totalAnnotationCount(): number {
    let total = 0;
    for (const scene of this.scenes.values()) {
      total += scene.count();
    }
    return total;
  }
}

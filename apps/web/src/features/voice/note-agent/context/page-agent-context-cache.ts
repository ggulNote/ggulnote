import type {
  LiveSceneContext,
  NoteCatalogObject,
  ObjectHandle,
  PageBaseSnapshot,
} from "../domain";

interface CachedPageContext {
  nextHandle: number;
  readonly handleByObjectId: Map<string, ObjectHandle>;
  readonly observedHandles: Set<ObjectHandle>;
  base?: PageBaseSnapshot;
  baseFingerprints?: ReadonlyMap<ObjectHandle, string>;
}

export interface PageAgentContextInput {
  readonly documentId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly sceneMode: "pdf" | "blank";
  readonly objects: readonly NoteCatalogObject[];
  readonly lastOperation?: LiveSceneContext["lastOperation"];
  readonly createdAt: number;
}

export interface PageAgentContext {
  readonly pageBase: PageBaseSnapshot;
  readonly liveScene: LiveSceneContext;
}

/**
 * Route-local page cache. It owns stable request handles and freezes the first
 * observed catalog without introducing React state or a second world store.
 */
export class PageAgentContextCache {
  private readonly pages = new Map<string, CachedPageContext>();

  public handleFor(
    documentId: string,
    pageId: string,
    objectId: string,
  ): ObjectHandle {
    const page = this.page(documentId, pageId);
    const existing = page.handleByObjectId.get(objectId);
    if (existing !== undefined) return existing;
    const handle = `O${page.nextHandle}` as ObjectHandle;
    page.nextHandle += 1;
    page.handleByObjectId.set(objectId, handle);
    return handle;
  }

  public build(input: PageAgentContextInput): PageAgentContext {
    const page = this.page(input.documentId, input.pageId);
    assertUniqueHandles(input.objects);
    const current = input.objects.map(withoutLiveFlags);
    const currentByHandle = new Map(current.map((object) => [object.handle, object]));

    if (page.base === undefined || page.baseFingerprints === undefined) {
      const pageText = current
        .filter((object) => object.source === "pdf" && object.text !== undefined)
        .map((object) => object.text)
        .join("\n");
      const base = Object.freeze({
        documentId: input.documentId,
        pageId: input.pageId,
        baseRevision: `${input.pageId}@${input.sceneRevision}`,
        sceneMode: input.sceneMode,
        objects: Object.freeze(current),
        ...(pageText.length === 0 ? {} : { pageText }),
        createdAt: input.createdAt,
      }) satisfies PageBaseSnapshot;
      page.base = base;
      page.baseFingerprints = new Map(
        base.objects.map((object) => [object.handle, fingerprint(object)]),
      );
    }

    const base = page.base;
    const baseFingerprints = page.baseFingerprints;
    const createdObjects = current.filter((object) => !baseFingerprints.has(object.handle));
    const updatedObjects = current.filter((object) => {
      const baseFingerprint = baseFingerprints.get(object.handle);
      return baseFingerprint !== undefined && baseFingerprint !== fingerprint(object);
    });
    const deletedObjectIds = [...page.observedHandles]
      .filter((handle) => !currentByHandle.has(handle))
      .sort(compareHandles);
    current.forEach((object) => page.observedHandles.add(object.handle));

    const selectedObjectIds = input.objects
      .filter((object) => object.selected)
      .map((object) => object.handle);
    const focusedObjectId = input.objects.find((object) => object.focused)?.handle;
    const recentObjectIds = input.objects
      .filter((object) => object.recent)
      .map((object) => object.handle);
    const liveScene = Object.freeze({
      sceneRevision: input.sceneRevision,
      createdObjects: Object.freeze(createdObjects),
      updatedObjects: Object.freeze(updatedObjects),
      deletedObjectIds: Object.freeze(deletedObjectIds),
      selectedObjectIds: Object.freeze(selectedObjectIds),
      ...(focusedObjectId === undefined ? {} : { focusedObjectId }),
      recentObjectIds: Object.freeze(recentObjectIds),
      ...(input.lastOperation === undefined
        ? {}
        : { lastOperation: Object.freeze({ ...input.lastOperation }) }),
    }) satisfies LiveSceneContext;
    return Object.freeze({ pageBase: base, liveScene });
  }

  private page(documentId: string, pageId: string): CachedPageContext {
    const key = `${documentId}\u0000${pageId}`;
    const existing = this.pages.get(key);
    if (existing !== undefined) return existing;
    const created: CachedPageContext = {
      nextHandle: 1,
      handleByObjectId: new Map(),
      observedHandles: new Set(),
    };
    this.pages.set(key, created);
    return created;
  }
}

function withoutLiveFlags(object: NoteCatalogObject): NoteCatalogObject {
  return Object.freeze({
    ...object,
    bounds: Object.freeze({ ...object.bounds }),
    capabilities: Object.freeze([...object.capabilities]),
    selected: false,
    focused: false,
    recent: false,
    ...(object.parts === undefined
      ? {}
      : {
          parts: Object.freeze(object.parts.map((part) => Object.freeze({ ...part }))),
        }),
  });
}

function fingerprint(object: NoteCatalogObject): string {
  return JSON.stringify(object);
}

function compareHandles(left: ObjectHandle, right: ObjectHandle): number {
  return Number(left.slice(1)) - Number(right.slice(1));
}

function assertUniqueHandles(objects: readonly NoteCatalogObject[]): void {
  if (new Set(objects.map((object) => object.handle)).size !== objects.length) {
    throw new Error("Page agent context requires unique object handles.");
  }
}

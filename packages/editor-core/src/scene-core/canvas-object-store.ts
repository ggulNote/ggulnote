import type { PageId } from "@ggulnote/shared-types";
import type {
  CanvasObjectPatch,
  CanvasSceneObject,
  NewCanvasObject,
  SceneObjectKind,
} from "./types";
import type { SceneRevision } from "./revision";
import { createSceneRevisionTracker } from "./revision";

export interface CanvasObjectStoreListener {
  kind: "changed";
  pageId: PageId;
}

interface InternalStoreState {
  pageId: PageId;
  objects: Map<string, CanvasSceneObject>;
}

export interface CanvasObjectStoreOptions {
  idGenerator?: () => string;
  now?: () => number;
  defaultSceneRevision?: SceneRevision;
}

type MutableCanvasObject = Omit<CanvasSceneObject, "objectRevision" | "createdAt" | "updatedAt">;

export class CanvasObjectStore {
  private readonly scenes = new Map<PageId, InternalStoreState>();
  private readonly deleted = new Set<string>();
  private readonly objectIds = new Set<string>();
  private readonly listeners = new Set<(listener: CanvasObjectStoreListener) => void>();
  private readonly revisionTracker = createSceneRevisionTracker();
  private readonly idGenerator: () => string;
  private readonly now: () => number;

  public constructor(options: CanvasObjectStoreOptions = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => Date.now());
    if (Number.isFinite(options.defaultSceneRevision ?? 0)) {
      this.revisionTracker.set(options.defaultSceneRevision ?? 0);
    }
  }

  public getObject<T extends CanvasSceneObject>(objectId: string): T | undefined {
    const state = this.findStateByObject(objectId);
    if (!state) {
      return undefined;
    }
    const found = state.objects.get(objectId);
    return found ? ({ ...found } as T) : undefined;
  }

  public getPageObjects(pageId: PageId): CanvasSceneObject[] {
    const scene = this.getOrCreateScene(pageId);
    return sortObjects(
      [...scene.objects.values()]
        .filter((entry) => !this.deleted.has(entry.id))
        .map((entry) => ({ ...entry } as CanvasSceneObject)),
    );
  }

  public createObject(input: NewCanvasObject): CanvasSceneObject {
    const normalized = this.normalizeCanvasObject(input);
    const scene = this.getOrCreateScene(normalized.pageId);

    const now = this.now();
    const created = {
      ...normalized,
      objectRevision: 1,
      createdAt: Number.isFinite(now) ? now : undefined,
      updatedAt: Number.isFinite(now) ? now : undefined,
    } as CanvasSceneObject;

    scene.objects.set(created.id, created);
    this.objectIds.add(created.id);
    this.bumpRevision();
    this.notify(normalized.pageId);
    return { ...created };
  }

  public updateObject(id: string, patch: CanvasObjectPatch): CanvasSceneObject {
    const entry = this.findObject(id);
    if (!entry) {
      throw new Error(`Object not found: ${id}`);
    }

    const current = entry.object;
    const sceneId = entry.pageId;

    const next = {
      ...current,
      ...patch,
      id: current.id,
      source: current.source,
      kind: current.kind,
      pageId: current.pageId,
      objectRevision: current.objectRevision,
      createdAt: current.createdAt,
    } as CanvasSceneObject;

    if (isSceneObjectEqual(current, next)) {
      return { ...next };
    }

    const now = this.now();
    const updated = {
      ...next,
      objectRevision: current.objectRevision + 1,
      updatedAt: Number.isFinite(now) ? now : undefined,
    } as CanvasSceneObject;

    const scene = this.getOrCreateScene(sceneId);
    scene.objects.set(id, updated);
    this.bumpRevision();
    this.notify(sceneId);
    return { ...updated };
  }

  public removeObject(id: string): void {
    const entry = this.findObject(id);
    if (!entry) {
      return;
    }

    const scene = this.getOrCreateScene(entry.pageId);
    scene.objects.delete(id);
    this.deleted.add(id);
    this.objectIds.delete(id);
    this.bumpRevision();
    this.notify(entry.pageId);
  }

  public moveObject(id: string, delta: { x: number; y: number }): CanvasSceneObject {
    const entry = this.findObject(id);
    if (!entry) {
      throw new Error(`Object not found: ${id}`);
    }

    return this.updateObject(id, {
      bounds: {
        x: entry.object.bounds.x + safeNumber(delta.x, 0),
        y: entry.object.bounds.y + safeNumber(delta.y, 0),
        width: entry.object.bounds.width,
        height: entry.object.bounds.height,
      },
    });
  }

  public resizeObject(id: string, bounds: { x: number; y: number; width: number; height: number }): CanvasSceneObject {
    return this.updateObject(id, { bounds });
  }

  public setVisibility(id: string, visible: boolean): CanvasSceneObject {
    return this.updateObject(id, { visible });
  }

  public setLocked(id: string, locked: boolean): CanvasSceneObject {
    return this.updateObject(id, { locked });
  }

  public reorderObject(id: string, zIndex: number): CanvasSceneObject {
    return this.updateObject(id, { zIndex: safeNumber(zIndex, 0) });
  }

  public subscribe(listener: (listener: CanvasObjectStoreListener) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSceneRevision(): SceneRevision {
    return this.revisionTracker.get();
  }

  public clear(): void {
    for (const pageId of this.scenes.keys()) {
      this.notify(pageId);
    }
    this.scenes.clear();
    this.deleted.clear();
    this.objectIds.clear();
    this.revisionTracker.reset();
  }

  public removePage(pageId: PageId): void {
    const removed = this.scenes.get(pageId);
    if (!removed) {
      return;
    }

    for (const objectId of removed.objects.keys()) {
      this.deleted.add(objectId);
      this.objectIds.delete(objectId);
    }

    this.scenes.delete(pageId);
    this.bumpRevision();
    this.notify(pageId);
  }

  private getOrCreateScene(pageId: PageId): InternalStoreState {
    let scene = this.scenes.get(pageId);
    if (!scene) {
      scene = { pageId, objects: new Map<string, CanvasSceneObject>() };
      this.scenes.set(pageId, scene);
    }

    return scene;
  }

  private findStateByObject(objectId: string): InternalStoreState | undefined {
    if (!objectId) {
      return undefined;
    }

    for (const scene of this.scenes.values()) {
      if (scene.objects.has(objectId)) {
        return scene;
      }
    }

    return undefined;
  }

  private findObject(id: string): { pageId: PageId; object: CanvasSceneObject } | undefined {
    if (!id) {
      return undefined;
    }

    for (const [pageId, scene] of this.scenes.entries()) {
      const existing = scene.objects.get(id);
      if (existing && !this.deleted.has(id)) {
        return { pageId, object: existing };
      }
    }

    return undefined;
  }

  private normalizeCanvasObject(input: NewCanvasObject): MutableCanvasObject {
    const pageId = input.pageId;
    const kind = normalizeKind(input.kind);
    const id = this.buildObjectId(pageId, kind, input.id);
    const baseBounds = normalizeBounds(input.bounds);
    const normalized = {
      ...input,
      source: "canvas",
      kind,
      pageId,
      bounds: baseBounds,
      id,
      zIndex: safeNumber(input.zIndex, 0),
      visible: input.visible ?? true,
      locked: input.locked ?? false,
    } as MutableCanvasObject;

    return normalized;
  }

  private buildObjectId(pageId: PageId, kind: SceneObjectKind, id?: string): string {
    const candidate = id && id.trim().length > 0
      ? sanitizeId(id)
      : sanitizeId(this.idGenerator());
    const resolved = candidate.startsWith("canvas:")
      ? candidate
      : `canvas:${pageId}:${kind}:${candidate}`;

    if (this.objectIds.has(resolved) || this.deleted.has(resolved) || this.findObject(resolved)) {
      throw new Error(`Duplicate canvas object id: ${resolved}`);
    }

    return resolved;
  }

  private bumpRevision(): SceneRevision {
    return this.revisionTracker.next();
  }

  private notify(pageId: PageId): void {
    for (const listener of this.listeners) {
      listener({ kind: "changed", pageId });
    }
  }
}

const isSceneObjectEqual = (left: CanvasSceneObject, right: CanvasSceneObject): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const sortObjects = (objects: CanvasSceneObject[]): CanvasSceneObject[] =>
  [...objects].sort((left, right) => {
    if (left.zIndex === right.zIndex) {
      return left.id.localeCompare(right.id);
    }
    return left.zIndex - right.zIndex;
  });

const normalizeKind = (kind: SceneObjectKind): MutableCanvasObject["kind"] => {
  if (kind === "pdf-region" || kind === "paragraph" || kind === "line" || kind === "word") {
    throw new Error(`Invalid canvas object kind: ${kind}`);
  }

  return kind;
};

const normalizeBounds = (
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
): MutableCanvasObject["bounds"] => ({
  x: safeNumber(bounds.x, 0),
  y: safeNumber(bounds.y, 0),
  width: Math.max(0, safeNumber(bounds.width, 0)),
  height: Math.max(0, safeNumber(bounds.height, 0)),
});

const safeNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const defaultIdGenerator = () => {
  if (typeof crypto === "object" && typeof (crypto as { randomUUID: () => string }).randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const sanitizeId = (value: string): string => {
  const sanitized = value.trim();
  if (sanitized.length > 0) {
    return sanitized.replace(/\s+/gu, "-");
  }

  return "item";
};



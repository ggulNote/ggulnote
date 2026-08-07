import type { PageId, Rect } from "@ggulnote/shared-types";
import type { CanvasSceneObject, SceneObject } from "./types";
import { clampRectToPage } from "./coordinate";
import { CanvasObjectStore } from "./canvas-object-store";

export interface CanvasSceneAdapterInput {
  pageId: PageId;
  pageBounds: Rect;
  store: CanvasObjectStore;
}

export interface CanvasSceneAdapterOutput {
  objects: SceneObject[];
}

export const buildCanvasSceneObjects = (input: CanvasSceneAdapterInput): CanvasSceneAdapterOutput => {
  const page = {
    width: sanitizeDimension(input.pageBounds.width),
    height: sanitizeDimension(input.pageBounds.height),
  };

  const sourceObjects = input.store.getPageObjects(input.pageId);
  const objects = sourceObjects.map((entry) => toSceneObject(entry, page, sourceObjects));
  return { objects };
};

export const resolveCanvasGroupBounds = (
  objects: readonly CanvasSceneObject[],
  groupId: string,
  page: { width: number; height: number },
): Rect | null => {
  const group = objects.find(
    (entry): entry is Extract<CanvasSceneObject, { kind: "group" }> =>
      entry.kind === "group" && entry.id === groupId,
  );

  if (!group) {
    return null;
  }

  const childRects = group.childIds
    .map((id) => objects.find((entry) => entry.id === id))
    .filter((entry): entry is CanvasSceneObject => entry !== undefined)
    .map((entry) => entry.bounds)
    .filter((bounds) => bounds.width > 0 && bounds.height > 0);

  if (childRects.length === 0) {
    return null;
  }

  const first = childRects[0];
  const union = childRects.slice(1).reduce(
    (acc, bounds) => {
      const right = bounds.x + bounds.width;
      const bottom = bounds.y + bounds.height;
      const accRight = acc.x + acc.width;
      const accBottom = acc.y + acc.height;

      return {
        x: Math.min(acc.x, bounds.x),
        y: Math.min(acc.y, bounds.y),
        width: Math.max(accRight, right) - Math.min(acc.x, bounds.x),
        height: Math.max(accBottom, bottom) - Math.min(acc.y, bounds.y),
      };
    },
    { ...first },
  );

  return clampRectToPage(union, {
    width: sanitizeDimension(page.width),
    height: sanitizeDimension(page.height),
  });
};

const toSceneObject = (
  input: CanvasSceneObject,
  page: { width: number; height: number },
  allObjects: readonly CanvasSceneObject[],
): SceneObject => {
  const clamped = clampRectToPage(input.bounds, page);

  if (input.kind === "group") {
    const union = resolveCanvasGroupBounds(allObjects, input.id, page);
    if (union && union.width > 0 && union.height > 0) {
      return {
        ...input,
        bounds: union,
      };
    }

    return {
      ...input,
      bounds: clamped,
    };
  }

  return {
    ...input,
    bounds: clamped,
  };
};

const sanitizeDimension = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

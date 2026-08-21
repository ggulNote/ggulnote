import type { Rect } from "@ggulnote/editor-core";
import type { SpatialSceneSnapshot } from "../domain";

const NORMALIZED_PAGE_BOUNDS = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

export const SCENE_VISUAL_CONTEXT_POLICY = Object.freeze({
  simpleObjectLimit: 4,
  simpleOccupiedRatioLimit: 0.28,
  simpleOverlapPairLimit: 1,
});

/** A small local gate: screenshots/previews are useful only after catalog geometry becomes dense. */
export function needsVisualContext(
  scene: Pick<SpatialSceneSnapshot, "editableBounds" | "objects">,
): boolean {
  const objects = scene.objects
    .filter((object) => object.visible && object.protection !== "IGNORE")
    .map((object) => object.renderBounds);
  return needsVisualContextForBounds(scene.editableBounds, objects);
}

/** Decision input already contains page-normalized catalog bounds, so no second scene read is needed. */
export function needsCatalogVisualContext(
  objects: readonly { readonly bounds: Rect }[],
): boolean {
  return needsVisualContextForBounds(
    NORMALIZED_PAGE_BOUNDS,
    objects.map((object) => object.bounds),
  );
}

function needsVisualContextForBounds(
  editableBounds: Rect,
  candidateBounds: readonly Rect[],
): boolean {
  const objects = candidateBounds.filter((bounds) =>
    intersectionArea(bounds, editableBounds) > 0,
  );
  if (objects.length > SCENE_VISUAL_CONTEXT_POLICY.simpleObjectLimit) return true;

  const editableArea = area(editableBounds);
  if (editableArea <= 0) return true;
  const occupiedArea = objects.reduce((sum, bounds) =>
    sum + intersectionArea(bounds, editableBounds), 0);
  if (Math.min(1, occupiedArea / editableArea)
    > SCENE_VISUAL_CONTEXT_POLICY.simpleOccupiedRatioLimit) return true;

  let overlapPairs = 0;
  for (let left = 0; left < objects.length; left += 1) {
    for (let right = left + 1; right < objects.length; right += 1) {
      if (intersectionArea(objects[left]!, objects[right]!) <= 0) continue;
      overlapPairs += 1;
      if (overlapPairs > SCENE_VISUAL_CONTEXT_POLICY.simpleOverlapPairLimit) return true;
    }
  }
  return false;
}

function intersectionArea(left: Rect, right: Rect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width)
    - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height)
    - Math.max(left.y, right.y));
  return width * height;
}

function area(rect: Rect): number {
  return Number.isFinite(rect.width) && Number.isFinite(rect.height)
    ? Math.max(0, rect.width) * Math.max(0, rect.height)
    : 0;
}

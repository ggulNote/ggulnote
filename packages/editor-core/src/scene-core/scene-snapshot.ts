import type {
  CanvasSceneObject,
  PdfSceneObject,
  SceneMode,
  SceneObject,
  ScenePage,
  SceneSnapshot,
} from "./types";

export interface SceneSnapshotInput {
  mode: SceneMode;
  page: ScenePage;
  sceneRevision: number;
  pdfObjects?: readonly PdfSceneObject[];
  canvasObjects?: readonly CanvasSceneObject[];
}

export interface SceneSnapshotWithStats extends SceneSnapshot {
  pdfObjectCount: number;
  canvasObjectCount: number;
}

export const buildSceneSnapshot = (input: SceneSnapshotInput): SceneSnapshotWithStats => {
  const objects: SceneObject[] = [];
  const byId = new Map<string, SceneObject>();

  const pushObject = (object: SceneObject) => {
    if (byId.has(object.id)) {
      throw new Error(`Duplicate scene object id: ${object.id}`);
    }

    byId.set(object.id, { ...object });
    objects.push(object);
  };

  const pdfObjectCount = input.pdfObjects ? input.pdfObjects.length : 0;
  const canvasObjectCount = input.canvasObjects ? input.canvasObjects.length : 0;

  if (input.mode === "pdf") {
    (input.pdfObjects ?? []).forEach((item) => pushObject(item));
  }

  (input.canvasObjects ?? []).forEach((item) => pushObject(item));

  const sorted = sortByRenderOrder(objects);
  const objectById: Record<string, SceneObject> = {};
  for (const obj of sorted) {
    objectById[obj.id] = obj;
  }

  return {
    sceneRevision: input.sceneRevision,
    mode: input.mode,
    page: { ...input.page },
    objects: sorted,
    objectById,
    renderOrder: sorted.map((entry) => entry.id),
    generatedAt: Date.now(),
    pdfObjectCount,
    canvasObjectCount,
  };
};

const sortByRenderOrder = (objects: SceneObject[]): SceneObject[] =>
  [...objects].sort((left, right) => {
    if (left.zIndex === right.zIndex) {
      return left.id.localeCompare(right.id);
    }

    return left.zIndex - right.zIndex;
  });

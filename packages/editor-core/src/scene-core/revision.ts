export type SceneRevision = number;

export interface Revisioned<T> {
  sceneRevision: SceneRevision;
  value: T;
}

export const clampRevision = (value: number): SceneRevision =>
  Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);

export const createSceneRevisionTracker = () => {
  let sceneRevision = 0;

  const next = (): SceneRevision => {
    sceneRevision += 1;
    return sceneRevision;
  };

  const get = (): SceneRevision => sceneRevision;
  const set = (value: SceneRevision): void => {
    sceneRevision = clampRevision(value);
  };
  const reset = (): SceneRevision => {
    sceneRevision = 0;
    return sceneRevision;
  };

  return { next, get, set, reset };
};

import type {
  OccupancyMap,
  OccupancyPolicy,
  PlacementCandidate,
  SceneContext,
  SceneMode,
  SceneObject,
  ScenePage,
} from "./types";
import { buildOccupancyMap } from "./occupancy";
import { buildPlacementCandidates, type PlacementCandidateInput } from "./placement";

export interface SceneContextBuilderInput {
  sceneRevision: number;
  mode: SceneMode;
  page: ScenePage;
  objects: readonly SceneObject[];
  focusObjectId?: string;
  focusBounds?: { x: number; y: number; width: number; height: number };
  occupancyPolicy: OccupancyPolicy;
  placementMaxCandidates?: number;
  placementMinimumWidth?: number;
  placementMinimumHeight?: number;
}

export interface SceneContextBuilderOutput extends SceneContext {
  occupancyMap: OccupancyMap;
  placementCandidates: PlacementCandidate[];
}

export const buildSceneContext = (input: SceneContextBuilderInput): SceneContextBuilderOutput => {
  const objects = [...input.objects].map((entry) => ({ ...entry }));
  const occupancyMap = buildOccupancyMap({
    sceneRevision: input.sceneRevision,
    pageBounds: {
      x: 0,
      y: 0,
      width: input.page.width,
      height: input.page.height,
    },
    objects,
    policy: input.occupancyPolicy,
  });

  const focus = input.focusObjectId || input.focusBounds
    ? {
      objectId: input.focusObjectId,
      bounds: input.focusBounds,
    }
    : undefined;

  const placementInput: PlacementCandidateInput = {
    sceneRevision: input.sceneRevision,
    page: input.page,
    objects,
    occupancy: occupancyMap,
    focus,
    maxCandidates: input.placementMaxCandidates,
    minimumWidth: input.placementMinimumWidth,
    minimumHeight: input.placementMinimumHeight,
  };

  const placementCandidates = buildPlacementCandidates(placementInput).candidates;

  return {
    sceneRevision: input.sceneRevision,
    mode: input.mode,
    page: { ...input.page },
    focus: focus,
    objects,
    occupancyMap,
    placementCandidates,
  };
};

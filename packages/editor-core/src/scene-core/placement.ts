import type { Rect } from "@ggulnote/shared-types";
import {
  clampRectToPage,
  normalizeRect,
} from "./coordinate";
import type {
  OccupancyMap,
  PlacementCandidate,
  PlacementRelation,
  SceneObject,
  ScenePage,
} from "./types";

export interface PlacementCandidateInput {
  sceneRevision: number;
  page: ScenePage;
  objects: readonly SceneObject[];
  occupancy: OccupancyMap;
  focus?: {
    objectId?: string;
    bounds?: Rect;
  };
  maxCandidates?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  minimumCollisionArea?: number;
}

export interface PlacementCandidateResult {
  candidates: PlacementCandidate[];
}

const DEFAULT_MAX_CANDIDATES = 24;

const RELATION_PRIORITY: ReadonlyArray<PlacementRelation> = [
  "PAGE_FREE_SPACE",
  "ABOVE_FOCUS",
  "BELOW_FOCUS",
  "LEFT_OF_FOCUS",
  "RIGHT_OF_FOCUS",
];

interface ResolvedFocus {
  objectId?: string;
  bounds?: Rect;
}

export const buildPlacementCandidates = (
  input: PlacementCandidateInput,
): PlacementCandidateResult => {
  const page = clampRectToPage(
    {
      x: 0,
      y: 0,
      width: sanitizeDimension(input.page.width),
      height: sanitizeDimension(input.page.height),
    },
    {
      width: sanitizeDimension(input.page.width),
      height: sanitizeDimension(input.page.height),
    },
  );

  const minWidth = sanitizeDimension(input.minimumWidth);
  const minHeight = sanitizeDimension(input.minimumHeight);
  const maxCandidates = Math.max(1, Math.floor(sanitizeDimension(input.maxCandidates) || DEFAULT_MAX_CANDIDATES));

  const focus = resolveFocusBounds(input.focus, input.objects);
  const blocking = input.occupancy.objects.filter((entry) => entry.blocking);

  const candidateSet = new Map<string, PlacementCandidate>();

  const addCandidate = (relation: PlacementRelation, bounds: Rect, allowFocusOverlap = false) => {
    const candidate = normalizeCandidate({
      sceneRevision: input.sceneRevision,
      relation,
      bounds,
      page,
      objects: input.objects,
      focusBounds: focus?.bounds,
      minWidth: minWidth > 0 ? minWidth : 0,
      minHeight: minHeight > 0 ? minHeight : 0,
    });

    if (!candidate) {
      return;
    }

    if (!isCandidateAcceptable(candidate, blocking, sanitizeDimension(input.minimumCollisionArea), focus?.objectId, allowFocusOverlap)) {
      return;
    }

    const key = keyFromBounds(candidate.bounds, relation);
    const existing = candidateSet.get(key);
    if (!existing || candidate.score > existing.score) {
      candidateSet.set(key, candidate);
    }
  };

  addCandidate("PAGE_FREE_SPACE", page);

  for (const blocked of blocking) {
    const bounds = blocked.bounds;

    addCandidate("PAGE_FREE_SPACE", {
      x: 0,
      y: 0,
      width: page.width,
      height: bounds.y,
    });

    addCandidate("PAGE_FREE_SPACE", {
      x: 0,
      y: bounds.y + bounds.height,
      width: page.width,
      height: page.height - (bounds.y + bounds.height),
    });

    addCandidate("PAGE_FREE_SPACE", {
      x: 0,
      y: 0,
      width: bounds.x,
      height: page.height,
    });

    addCandidate("PAGE_FREE_SPACE", {
      x: bounds.x + bounds.width,
      y: 0,
      width: page.width - (bounds.x + bounds.width),
      height: page.height,
    });
  }

  if (focus?.bounds) {
    addCandidate("ABOVE_FOCUS", {
      x: focus.bounds.x,
      y: 0,
      width: focus.bounds.width,
      height: focus.bounds.y,
    }, true);

    addCandidate("BELOW_FOCUS", {
      x: focus.bounds.x,
      y: focus.bounds.y + focus.bounds.height,
      width: focus.bounds.width,
      height: page.height - (focus.bounds.y + focus.bounds.height),
    }, true);

    addCandidate("LEFT_OF_FOCUS", {
      x: 0,
      y: focus.bounds.y,
      width: focus.bounds.x,
      height: focus.bounds.height,
    }, true);

    addCandidate("RIGHT_OF_FOCUS", {
      x: focus.bounds.x + focus.bounds.width,
      y: focus.bounds.y,
      width: page.width - (focus.bounds.x + focus.bounds.width),
      height: focus.bounds.height,
    }, true);
  }

  const ordered = [...candidateSet.values()].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftRelationIndex = RELATION_PRIORITY.indexOf(left.relation);
    const rightRelationIndex = RELATION_PRIORITY.indexOf(right.relation);
    if (leftRelationIndex !== rightRelationIndex) {
      return leftRelationIndex - rightRelationIndex;
    }

    if (left.area !== right.area) {
      return right.area - left.area;
    }

    return left.id.localeCompare(right.id);
  });

  return {
    candidates: ordered.slice(0, maxCandidates),
  };
};

interface NormalizeCandidateInput {
  sceneRevision: number;
  relation: PlacementRelation;
  bounds: Rect;
  page: Rect;
  objects: readonly SceneObject[];
  focusBounds?: Rect;
  minWidth: number;
  minHeight: number;
}

const normalizeCandidate = (input: NormalizeCandidateInput): PlacementCandidate | null => {
  const intersect = intersectRect(normalizeRect(input.bounds), input.page);
  if (!intersect) {
    return null;
  }

  const clamped = clampRectToPage(intersect, input.page);
  const minimumWidth = Math.max(input.minWidth, 1);
  const minimumHeight = Math.max(input.minHeight, 1);

  if (clamped.width < minimumWidth || clamped.height < minimumHeight) {
    return null;
  }

  const nearbyObjectIds = collectNearbyObjectIds(clamped, input.objects);
  const score = calculateCandidateScore(clamped, input.relation, input.page, input.focusBounds);
  const area = clampToFinite(clamped.width) * clampToFinite(clamped.height);
  const id = `c:${input.sceneRevision}:${input.relation}:${keyFromBounds(clamped, input.relation)}`;

  return {
    id,
    sceneRevision: input.sceneRevision,
    relation: input.relation,
    bounds: clamped,
    area,
    score,
    nearbyObjectIds,
  };
};

const isCandidateAcceptable = (
  candidate: PlacementCandidate,
  blocking: PlacementCandidateInput["occupancy"]["objects"],
  minimumCollisionArea: number,
  focusObjectId?: string,
  allowFocusOverlap = false,
): boolean => {
  if (candidate.bounds.width <= 0 || candidate.bounds.height <= 0) {
    return false;
  }

  for (const object of blocking) {
    if (allowFocusOverlap && focusObjectId && object.objectId === focusObjectId) {
      continue;
    }

    const collisionArea = areaIntersection(candidate.bounds, object.bounds);
    if (collisionArea > minimumCollisionArea) {
      return false;
    }
  }

  return true;
};

const calculateCandidateScore = (
  bounds: Rect,
  relation: PlacementRelation,
  page: Rect,
  focusBounds: Rect | undefined,
): number => {
  const areaScore = bounds.width * bounds.height;

  const edgeDistance = Math.min(
    bounds.x,
    bounds.y,
    Math.max(0, page.width - (bounds.x + bounds.width)),
    Math.max(0, page.height - (bounds.y + bounds.height)),
  );
  const edgeScore = edgeDistance;

  let relationScore = 0;
  if (relation !== "PAGE_FREE_SPACE" && focusBounds) {
    const candidateCenterX = bounds.x + bounds.width / 2;
    const candidateCenterY = bounds.y + bounds.height / 2;
    const focusCenterX = focusBounds.x + focusBounds.width / 2;
    const focusCenterY = focusBounds.y + focusBounds.height / 2;
    const centerDistance = Math.hypot(candidateCenterX - focusCenterX, candidateCenterY - focusCenterY);
    relationScore -= centerDistance * 2;
  }

  const whitespaceScore = bounds.width + bounds.height;

  return areaScore + whitespaceScore + edgeScore + relationScore;
};

const collectNearbyObjectIds = (bounds: Rect, objects: readonly SceneObject[]): string[] => {
  return objects
    .map((object) => ({
      id: object.id,
      distance: centerDistance(bounds, object.bounds),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 6)
    .map((entry) => entry.id);
};

const resolveFocusBounds = (
  focus: { objectId?: string; bounds?: Rect } | undefined,
  objects: readonly SceneObject[],
): ResolvedFocus | undefined => {
  if (!focus) {
    return undefined;
  }

  if (focus.bounds) {
    return {
      objectId: focus.objectId,
      bounds: normalizeRect(focus.bounds),
    };
  }

  if (focus.objectId) {
    const target = objects.find((entry) => entry.id === focus.objectId);
    if (target) {
      return {
        objectId: focus.objectId,
        bounds: normalizeRect(target.bounds),
      };
    }
  }

  return undefined;
};

const centerDistance = (left: Rect, right: Rect): number => {
  const lx = left.x + left.width / 2;
  const ly = left.y + left.height / 2;
  const rx = right.x + right.width / 2;
  const ry = right.y + right.height / 2;
  return Math.hypot(lx - rx, ly - ry);
};

const sanitizeDimension = (value: number | undefined): number => {
  if (!Number.isFinite(value as number)) {
    return 0;
  }

  return Math.max(0, value as number);
};

const clampToFinite = (value: number): number => {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const keyFromBounds = (rect: Rect, relation: PlacementRelation): string => {
  const x = safeRound(rect.x);
  const y = safeRound(rect.y);
  const width = safeRound(rect.width);
  const height = safeRound(rect.height);
  return `${relation}:${x}:${y}:${width}:${height}`;
};

const safeRound = (value: number): number => Math.round(clampToFinite(value) * 1000);

const intersectRect = (left: Rect, right: Rect): Rect | null => {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);

  const width = x2 - x1;
  const height = y2 - y1;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: x1,
    y: y1,
    width,
    height,
  };
};

const areaIntersection = (left: Rect, right: Rect): number => {
  const intersection = intersectRect(left, right);
  return intersection ? intersection.width * intersection.height : 0;
};

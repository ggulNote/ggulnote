import type { Rect } from "@ggulnote/shared-types";
import type { PlacementValidationInput, PlacementValidationResult, PlacementRequest } from "./types";
import { buildOccupancyMap } from "./occupancy";
import { clampRectToPage } from "./coordinate";

export const validatePlacementRequest = (input: PlacementValidationInput): PlacementValidationResult => {
  const { request, scene, candidates, policy } = input;

  if (request.sceneRevision !== scene.sceneRevision) {
    return { valid: false, reason: "SCENE_REVISION_MISMATCH" };
  }

  const candidate = candidates.find((item) => item.id === request.candidateId);
  if (!candidate) {
    return { valid: false, reason: "CANDIDATE_NOT_FOUND" };
  }

  const requestedBounds = resolveRequestedBounds(request, candidate.bounds, policy);
  if (!requestedBounds) {
    return { valid: false, reason: "INVALID_SIZE" };
  }

  if (
    !isFinitePositive(requestedBounds.width)
    || !isFinitePositive(requestedBounds.height)
  ) {
    return { valid: false, reason: "INVALID_SIZE" };
  }

  if (
    requestedBounds.width < policy.minimumCandidateWidth
    || requestedBounds.height < policy.minimumCandidateHeight
  ) {
    return { valid: false, reason: "INSUFFICIENT_SPACE" };
  }

  const pageBounds = {
    x: 0,
    y: 0,
    width: scene.page.width,
    height: scene.page.height,
  };
  const withinPage = clampRectToPage(requestedBounds, pageBounds);

  if (!policy.allowOutOfPage) {
    if (
      requestedBounds.width !== withinPage.width
      || requestedBounds.height !== withinPage.height
      || requestedBounds.x !== withinPage.x
      || requestedBounds.y !== withinPage.y
    ) {
      return { valid: false, reason: "OUT_OF_PAGE" };
    }
  }

  const hasCollision = sceneCollides(scene, withinPage, policy);
  if (hasCollision) {
    return { valid: false, reason: "COLLISION" };
  }

  return {
    valid: true,
    resolvedBounds: withinPage,
  };
};

const resolveRequestedBounds = (
  request: PlacementRequest,
  candidateBounds: Rect,
  policy: PlacementValidationInput["policy"],
): Rect | null => {
  switch (request.sizePolicy) {
    case "FIT_CONTENT":
    case "FIT_CANDIDATE":
      return {
        ...candidateBounds,
      };

    case "FIXED": {
      const size = request.requestedSize;
      if (!size) {
        return null;
      }

      const width = sanitizeDimension(size.width);
      const height = sanitizeDimension(size.height);
      if (!isFinitePositive(width) || !isFinitePositive(height)) {
        return null;
      }

      return computeAlignedBounds(request.alignment, candidateBounds, {
        width,
        height,
      });
    }

    default:
      return null;
  }
};

const computeAlignedBounds = (
  alignment: PlacementRequest["alignment"],
  candidateBounds: Rect,
  requestedSize: { width: number; height: number },
): Rect => {
  const targetWidth = requestedSize.width;
  const targetHeight = requestedSize.height;

  switch (alignment) {
    case "TOP_LEFT":
      return {
        x: candidateBounds.x,
        y: candidateBounds.y,
        width: targetWidth,
        height: targetHeight,
      };
    case "TOP_CENTER":
      return {
        x: candidateBounds.x + Math.max(0, (candidateBounds.width - targetWidth) / 2),
        y: candidateBounds.y,
        width: targetWidth,
        height: targetHeight,
      };
    case "CENTER":
      return {
        x: candidateBounds.x + Math.max(0, (candidateBounds.width - targetWidth) / 2),
        y: candidateBounds.y + Math.max(0, (candidateBounds.height - targetHeight) / 2),
        width: targetWidth,
        height: targetHeight,
      };
    case "BOTTOM_LEFT":
      return {
        x: candidateBounds.x,
        y: candidateBounds.y + Math.max(0, candidateBounds.height - targetHeight),
        width: targetWidth,
        height: targetHeight,
      };
    case "BOTTOM_CENTER":
      return {
        x: candidateBounds.x + Math.max(0, (candidateBounds.width - targetWidth) / 2),
        y: candidateBounds.y + Math.max(0, candidateBounds.height - targetHeight),
        width: targetWidth,
        height: targetHeight,
      };
  }
};

const sceneCollides = (
  scene: PlacementValidationInput["scene"],
  bounds: Rect,
  policy: PlacementValidationInput["policy"],
): boolean => {
  const occupancy = buildOccupancyMap({
    sceneRevision: scene.sceneRevision,
    pageBounds: {
      x: 0,
      y: 0,
      width: scene.page.width,
      height: scene.page.height,
    },
    objects: scene.objects,
    policy: {
      includeInvisible: true,
      includeAnnotations: true,
      annotationBlockingTypes: policy.annotationBlockingTypes ?? ["box"],
      padding: 0,
      minimumBlockingSize: {
        width: 0,
        height: 0,
      },
    },
  });

  return occupancy.objects
    .filter((entry) => entry.blocking)
    .some((entry) => intersectionArea(entry.bounds, bounds) > policy.minimumCollisionArea);
};

const intersectionArea = (left: Rect, right: Rect): number => {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);

  const width = x2 - x1;
  const height = y2 - y1;

  if (width <= 0 || height <= 0) {
    return 0;
  }

  return width * height;
};

const sanitizeDimension = (value: number): number => {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

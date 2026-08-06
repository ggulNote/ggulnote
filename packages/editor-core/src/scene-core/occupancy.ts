import type { Rect, Size } from "@ggulnote/shared-types";
import type {
  OccupancyMap,
  OccupancyObject,
  OccupancyPolicy,
  SceneObject,
  SceneObjectKind,
  AnnotationSceneObject,
} from "./types";
import { clampRectToPage } from "./coordinate";

export interface OccupancyBuilderInput {
  sceneRevision: number;
  pageBounds: Rect;
  objects: readonly SceneObject[];
  policy: OccupancyPolicy;
}

export const buildOccupancyMap = (input: OccupancyBuilderInput): OccupancyMap => {
  const page = {
    width: sanitizeDimension(input.pageBounds.width),
    height: sanitizeDimension(input.pageBounds.height),
  };
  const policy = normalizePolicy(input.policy);

  const rows: OccupancyObject[] = [];
  for (const object of input.objects) {
    if (!object.visible && !policy.includeInvisible) {
      continue;
    }

    if (object.kind === "annotation" && !policy.includeAnnotations) {
      continue;
    }

    const clamped = clampRectToPage(
      {
        x: object.bounds.x,
        y: object.bounds.y,
        width: object.bounds.width,
        height: object.bounds.height,
      },
      page,
    );

    const minWidth = policy.minimumBlockingSize.width;
    const minHeight = policy.minimumBlockingSize.height;
    if (clamped.width < minWidth || clamped.height < minHeight) {
      continue;
    }

    const withPadding = applyPadding(clamped, policy.padding);
    const expanded = clampRectToPage(withPadding, page);

    const blocking = isBlocking(object, policy);
    rows.push({
      objectId: object.id,
      kind: object.kind,
      bounds: expanded,
      blocking,
    });
  }

  return {
    sceneRevision: input.sceneRevision,
    pageBounds: {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    },
    objects: rows,
  };
};

const isBlocking = (
  object: SceneObject,
  policy: OccupancyPolicy,
): boolean => {
  if (object.kind === "annotation") {
    const annotation = object as AnnotationSceneObject;
    return policy.annotationBlockingTypes.includes(annotation.annotationType);
  }

  if (object.kind === "paragraph" || object.kind === "word") {
    return true;
  }

  if (object.kind === "image" || object.kind === "table" || object.kind === "shape" || object.kind === "text" || object.kind === "math" || object.kind === "graph" || object.kind === "group") {
    return true;
  }

  return false;
};

const applyPadding = (rect: Rect, padding: number): Rect => {
  const safe = sanitizeDimension(padding);
  return {
    x: rect.x - safe,
    y: rect.y - safe,
    width: rect.width + safe * 2,
    height: rect.height + safe * 2,
  };
};

const sanitizeDimension = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const normalizePolicy = (policy: OccupancyPolicy): OccupancyPolicy => ({
  includeInvisible: Boolean(policy.includeInvisible),
  includeAnnotations: Boolean(policy.includeAnnotations),
  annotationBlockingTypes: policy.annotationBlockingTypes.length > 0 ? [...policy.annotationBlockingTypes] : ["box"],
  padding: sanitizeDimension(policy.padding),
  minimumBlockingSize: {
    width: sanitizeDimension(policy.minimumBlockingSize?.width ?? 0),
    height: sanitizeDimension(policy.minimumBlockingSize?.height ?? 0),
  },
});

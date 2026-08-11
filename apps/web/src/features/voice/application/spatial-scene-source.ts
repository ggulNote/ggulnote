import type {
  Point,
  Rect,
  SceneObject,
  SceneSnapshot,
} from "@ggulnote/editor-core";
import type {
  FrozenSpatialFocus,
  FrozenSpatialSelection,
  ProtectionPolicy,
  SpatialProtection,
  SpatialSceneObject,
  SpatialSceneSnapshot,
  SpatialSemanticRole,
  SpatialSourceLayer,
} from "../domain";

const TEXT_PREVIEW_LIMIT = 160;

export interface FrozenSpatialSceneReference {
  readonly pageId: SceneSnapshot["page"]["id"];
  readonly sceneRevision: SceneSnapshot["sceneRevision"];
  readonly capturedAt: number;
  readonly rotation: number;
  readonly editableBounds?: Rect;
  readonly viewportBounds: Rect;
  readonly focus?: FrozenSpatialFocus;
  readonly focusStale?: boolean;
  readonly selection?: FrozenSpatialSelection;
}

export type SpatialSceneSourceResult =
  | {
      readonly status: "READY";
      readonly snapshot: SpatialSceneSnapshot;
    }
  | {
      readonly status: "STALE_SCENE";
    }
  | {
      readonly status: "UNSUPPORTED";
      readonly reason: "INVALID_SCENE_GEOMETRY";
    };

export interface SpatialSceneSource {
  getSnapshot(reference: FrozenSpatialSceneReference): SpatialSceneSourceResult;
}

export interface FrozenSceneReadSource {
  getSnapshot(reference: {
    readonly pageId: SceneSnapshot["page"]["id"];
    readonly sceneRevision: SceneSnapshot["sceneRevision"];
  }): { readonly scene: SceneSnapshot } | undefined;
}

export interface ExistingSceneSpatialSceneSourceOptions {
  readonly sceneSource: FrozenSceneReadSource;
  readonly protectionPolicy?: ProtectionPolicy;
}

export class ExistingSceneSpatialSceneSource implements SpatialSceneSource {
  private readonly protectionPolicy: ProtectionPolicy;

  public constructor(
    private readonly options: ExistingSceneSpatialSceneSourceOptions,
  ) {
    this.protectionPolicy = options.protectionPolicy
      ?? DEFAULT_SPATIAL_PROTECTION_POLICY;
  }

  public getSnapshot(
    reference: FrozenSpatialSceneReference,
  ): SpatialSceneSourceResult {
    const scene = this.options.sceneSource.getSnapshot({
      pageId: reference.pageId,
      sceneRevision: reference.sceneRevision,
    })?.scene;
    if (
      scene === undefined
      || scene.page.id !== reference.pageId
      || scene.sceneRevision !== reference.sceneRevision
      || reference.focusStale === true
    ) {
      return { status: "STALE_SCENE" };
    }

    const pageBounds = {
      x: 0,
      y: 0,
      width: scene.page.width,
      height: scene.page.height,
    };
    const editableBounds = reference.editableBounds ?? pageBounds;
    if (
      !isValidPositiveRect(pageBounds)
      || !isRectInside(reference.viewportBounds, pageBounds)
      || !isRectInside(editableBounds, pageBounds)
      || !Number.isFinite(reference.rotation)
      || !Number.isFinite(reference.capturedAt)
      || reference.capturedAt < 0
      || !isFocusGeometryValid(reference.focus, pageBounds)
      || !isSelectionGeometryValid(reference.selection, pageBounds)
      || scene.objects.some(
        (object) =>
          object.pageId !== scene.page.id
          || !isRectWithinPageAllowEmpty(object.bounds, pageBounds),
      )
    ) {
      return { status: "UNSUPPORTED", reason: "INVALID_SCENE_GEOMETRY" };
    }

    if (
      referencesMissingObject(
        scene,
        reference.focus?.objectId === undefined
          ? []
          : [reference.focus.objectId],
      )
      || referencesMissingObject(scene, reference.selection?.objectIds ?? [])
    ) {
      return { status: "STALE_SCENE" };
    }

    const objects = scene.objects.map((object) =>
      toSpatialSceneObject(object, this.protectionPolicy),
    );
    const snapshot: SpatialSceneSnapshot = Object.freeze({
      snapshotId: spatialSnapshotId(reference),
      pageId: scene.page.id,
      sceneRevision: scene.sceneRevision,
      mode: scene.mode === "pdf" ? "PDF" : "BLANK",
      coordinateSpace: Object.freeze({
        kind: "PAGE_CANONICAL" as const,
        rotation: reference.rotation,
      }),
      pageBounds: freezeRect(pageBounds),
      editableBounds: freezeRect(editableBounds),
      viewportBounds: freezeRect(reference.viewportBounds),
      ...(reference.focus === undefined
        ? {}
        : { focus: freezeFocus(reference.focus) }),
      ...(reference.selection === undefined
        ? {}
        : { selection: freezeSelection(reference.selection) }),
      objects: Object.freeze(objects),
      capturedAt: reference.capturedAt,
    });

    return { status: "READY", snapshot };
  }
}

export class DefaultSpatialProtectionPolicy implements ProtectionPolicy {
  public classify(object: SceneObject): SpatialProtection {
    if (!object.visible) return "IGNORE";
    if (object.source === "pdf") return "HARD";
    if (object.kind !== "annotation") return "HARD";
    return object.annotationType === "underline"
      || object.annotationType === "highlight"
      || object.annotationType === "strikethrough"
      ? "SOFT"
      : "HARD";
  }
}

export const DEFAULT_SPATIAL_PROTECTION_POLICY: ProtectionPolicy =
  new DefaultSpatialProtectionPolicy();

export function classifySpatialProtection(object: SceneObject): SpatialProtection {
  return DEFAULT_SPATIAL_PROTECTION_POLICY.classify(object);
}

export function toSpatialSceneObject(
  object: SceneObject,
  policy: ProtectionPolicy = DEFAULT_SPATIAL_PROTECTION_POLICY,
): SpatialSceneObject {
  const textPreview = sceneObjectTextPreview(object);
  return Object.freeze({
    id: object.id,
    kind: object.kind,
    bounds: freezeRect(object.bounds),
    // Scene Core currently has one authoritative canonical footprint. Phase D may
    // replace this with renderer-measured bounds without changing this contract.
    renderBounds: freezeRect(object.bounds),
    sourceLayer: sourceLayer(object),
    semanticRole: semanticRole(object),
    protection: policy.classify(object),
    visible: object.visible,
    locked: object.locked,
    ...(hasReadingOrder(object)
      ? { readingOrder: object.readingOrder }
      : {}),
    zIndex: object.zIndex,
    ...(textPreview === undefined ? {} : { textPreview }),
  });
}

function sourceLayer(object: SceneObject): SpatialSourceLayer {
  if (object.source === "pdf") return "PDF_BASE";
  return object.kind === "annotation" ? "ANNOTATION" : "CANVAS";
}

function semanticRole(object: SceneObject): SpatialSemanticRole {
  switch (object.kind) {
    case "paragraph":
    case "line":
    case "word":
    case "text":
      return "TEXT";
    case "image":
      return object.source === "pdf"
        && object.imageSource?.toLowerCase().includes("formula")
        ? "FORMULA"
        : "FIGURE";
    case "table":
      return "TABLE";
    case "math":
      return "FORMULA";
    case "graph":
      return "GRAPH";
    case "pdf-region": {
      const type = object.regionType.toLowerCase();
      if (type.includes("formula")) return "FORMULA";
      if (type.includes("table")) return "TABLE";
      if (type.includes("picture") || type.includes("figure")) return "FIGURE";
      return "OTHER";
    }
    case "shape":
    case "annotation":
    case "group":
      return "OTHER";
  }
}

function sceneObjectTextPreview(object: SceneObject): string | undefined {
  if (
    object.kind !== "paragraph"
    && object.kind !== "line"
    && object.kind !== "word"
    && object.kind !== "text"
  ) {
    return undefined;
  }
  const compact = object.text.trim().replace(/\s+/gu, " ");
  if (compact.length === 0) return undefined;
  return compact.slice(0, TEXT_PREVIEW_LIMIT);
}

function hasReadingOrder(
  object: SceneObject,
): object is Extract<SceneObject, { readingOrder: number }> {
  return "readingOrder" in object && Number.isFinite(object.readingOrder);
}

function referencesMissingObject(
  scene: SceneSnapshot,
  objectIds: readonly string[],
): boolean {
  return objectIds.some((objectId) => scene.objectById[objectId] === undefined);
}

function isFocusGeometryValid(
  focus: FrozenSpatialFocus | undefined,
  pageBounds: Rect,
): boolean {
  if (focus === undefined) return true;
  return (focus.bounds === undefined || isRectInside(focus.bounds, pageBounds))
    && (focus.point === undefined || isPointInside(focus.point, pageBounds));
}

function isSelectionGeometryValid(
  selection: FrozenSpatialSelection | undefined,
  pageBounds: Rect,
): boolean {
  return selection === undefined
    || selection.bounds === undefined
    || isRectInside(selection.bounds, pageBounds);
}

function isPointInside(point: Point, pageBounds: Rect): boolean {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= pageBounds.x
    && point.y >= pageBounds.y
    && point.x <= pageBounds.x + pageBounds.width
    && point.y <= pageBounds.y + pageBounds.height;
}

function isRectInside(rect: Rect, pageBounds: Rect): boolean {
  return isValidPositiveRect(rect)
    && rect.x >= pageBounds.x
    && rect.y >= pageBounds.y
    && rect.x + rect.width <= pageBounds.x + pageBounds.width
    && rect.y + rect.height <= pageBounds.y + pageBounds.height;
}

function isRectWithinPageAllowEmpty(rect: Rect, pageBounds: Rect): boolean {
  return isValidRect(rect)
    && rect.x >= pageBounds.x
    && rect.y >= pageBounds.y
    && rect.x + rect.width <= pageBounds.x + pageBounds.width
    && rect.y + rect.height <= pageBounds.y + pageBounds.height;
}

function isValidPositiveRect(rect: Rect): boolean {
  return isValidRect(rect) && rect.width > 0 && rect.height > 0;
}

function isValidRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width >= 0
    && rect.height >= 0;
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

function freezeFocus(focus: FrozenSpatialFocus): FrozenSpatialFocus {
  return Object.freeze({
    source: focus.source,
    ...(focus.objectId === undefined ? {} : { objectId: focus.objectId }),
    ...(focus.bounds === undefined ? {} : { bounds: freezeRect(focus.bounds) }),
    ...(focus.point === undefined
      ? {}
      : { point: Object.freeze({ ...focus.point }) }),
  });
}

function freezeSelection(
  selection: FrozenSpatialSelection,
): FrozenSpatialSelection {
  return Object.freeze({
    objectIds: Object.freeze([...selection.objectIds]),
    ...(selection.bounds === undefined
      ? {}
      : { bounds: freezeRect(selection.bounds) }),
  });
}

function spatialSnapshotId(reference: FrozenSpatialSceneReference): string {
  return `spatial:${encodeURIComponent(reference.pageId)}:${reference.sceneRevision}:${reference.capturedAt}`;
}

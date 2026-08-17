import type {
  Rect,
  SceneObject,
  SceneObjectCapabilities,
  SceneObjectKind,
  SceneObjectMetadataView,
  UnifiedSceneObjectSource,
} from "@ggulnote/editor-core";
import type { EntityRef, UnifiedObjectWorld } from "../world";
import type {
  NoteCatalogObject,
  ObjectHandle as CatalogObjectHandle,
} from "../domain";

export interface ProjectedObjectHandle {
  readonly handle: string;
  readonly kind: SceneObjectKind;
  readonly summary?: string;
}

export interface ObjectAppearanceSummary {
  readonly dominantColor?: string;
  readonly fillColor?: string;
  readonly strokeColor?: string;
  readonly textColor?: string;
  readonly opacity?: number;
  readonly strokeWidth?: number;
  readonly fontSize?: number;
}

export interface ObjectSemanticSummary {
  readonly graphType?: string;
  readonly polynomialDegree?: number;
  readonly mathType?: string;
  readonly annotationType?: string;
  readonly rows?: number;
  readonly columns?: number;
}

export interface ObjectSummary extends ProjectedObjectHandle {
  readonly source: UnifiedSceneObjectSource;
  readonly bounds: Rect;
  readonly contentSummary?: string;
  readonly appearance?: ObjectAppearanceSummary;
  readonly semanticSummary?: ObjectSemanticSummary;
}

export interface ObjectPartSummary {
  readonly handle: string;
  readonly kind: string;
  readonly summary?: string;
  readonly bounds?: Rect;
  readonly attributes?: Readonly<Record<string, string | number>>;
}

export interface ObjectDetail extends ProjectedObjectHandle {
  readonly source: UnifiedSceneObjectSource;
  readonly geometry: {
    readonly bounds: Rect;
    readonly renderBounds: Rect;
    readonly rects?: readonly Rect[];
  };
  readonly appearance?: ObjectAppearanceSummary;
  readonly semantic?: Readonly<Record<string, unknown>>;
  readonly lifecycle?: {
    readonly createdAt?: number;
    readonly creationOrder?: number;
    readonly createdByTurnId?: string;
  };
  readonly parts?: readonly ObjectPartSummary[];
  readonly capabilities: SceneObjectCapabilities;
}

/** Persistent refs stay inside this request-local map and never enter Decision content. */
export class NoteObjectHandleMap {
  private readonly refs = new Map<string, EntityRef>();

  public register(handle: string, ref: EntityRef): void {
    if (!isHandle(handle)) throw new Error(`Invalid request-local object handle: ${handle}`);
    if (this.refs.has(handle)) throw new Error(`Duplicate request-local object handle: ${handle}`);
    this.refs.set(handle, cloneRef(ref));
  }

  public resolve(handle: string): EntityRef | undefined {
    const ref = this.refs.get(handle);
    return ref === undefined ? undefined : cloneRef(ref);
  }

  public handles(): readonly string[] {
    return Object.freeze([...this.refs.keys()]);
  }
}

export function projectObjectSummary(
  handle: string,
  ref: EntityRef,
  world: UnifiedObjectWorld,
): ObjectSummary | undefined {
  const projected = projectionSource(ref, world);
  if (projected === undefined) return undefined;
  const appearance = appearanceFor(projected.object);
  const semanticSummary = semanticSummaryFor(projected.object);
  const contentSummary = bound(projected.metadata.searchableText, 160);
  return Object.freeze({
    handle,
    kind: projected.metadata.kind,
    source: projected.metadata.source,
    bounds: freezeRect(projected.metadata.bounds),
    ...(contentSummary === undefined ? {} : { summary: contentSummary, contentSummary }),
    ...(appearance === undefined ? {} : { appearance }),
    ...(semanticSummary === undefined ? {} : { semanticSummary }),
  });
}

export function projectObjectDetail(
  handle: string,
  ref: EntityRef,
  world: UnifiedObjectWorld,
): ObjectDetail | undefined {
  const projected = projectionSource(ref, world);
  if (projected === undefined) return undefined;
  const metadata = projected.metadata;
  const appearance = appearanceFor(projected.object);
  const semantic = safeSemantic(metadata.semanticAttributes);
  const lifecycle = metadata.createdAt === undefined
    && metadata.creationOrder === undefined
    && metadata.createdByTurnId === undefined
    ? undefined
    : Object.freeze({
        ...(metadata.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
        ...(metadata.creationOrder === undefined ? {} : { creationOrder: metadata.creationOrder }),
        ...(metadata.createdByTurnId === undefined ? {} : { createdByTurnId: metadata.createdByTurnId }),
      });
  const parts = metadata.parts?.map((part, index) => Object.freeze({
    handle: `${handle}:part:${index + 1}`,
    kind: part.kind,
    ...(bound(part.searchableText, 120) === undefined
      ? {}
      : { summary: bound(part.searchableText, 120) }),
    ...(part.bounds === undefined ? {} : { bounds: freezeRect(part.bounds) }),
    ...(part.attributes === undefined
      ? {}
      : { attributes: Object.freeze({ ...part.attributes }) }),
  }));
  return Object.freeze({
    handle,
    kind: metadata.kind,
    source: metadata.source,
    ...(bound(metadata.searchableText, 160) === undefined
      ? {}
      : { summary: bound(metadata.searchableText, 160) }),
    geometry: Object.freeze({
      bounds: freezeRect(metadata.bounds),
      renderBounds: freezeRect(metadata.renderBounds),
      ...(metadata.rects === undefined
        ? {}
        : { rects: Object.freeze(metadata.rects.map(freezeRect)) }),
    }),
    ...(appearance === undefined ? {} : { appearance }),
    ...(semantic === undefined ? {} : { semantic }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(parts === undefined || parts.length === 0 ? {} : { parts: Object.freeze(parts) }),
    capabilities: Object.freeze({ ...metadata.capabilities }),
  });
}

export function projectCatalogObject(
  handle: CatalogObjectHandle,
  ref: EntityRef,
  world: UnifiedObjectWorld,
  pageSize: { readonly width: number; readonly height: number },
  context: {
    readonly selected: boolean;
    readonly focused: boolean;
    readonly recent: boolean;
  },
): NoteCatalogObject | undefined {
  const projected = projectionSource(ref, world);
  if (projected === undefined) return undefined;
  if (pageSize.width <= 0 || pageSize.height <= 0) return undefined;
  const metadata = projected.metadata;
  const summary = bound(metadata.searchableText, 160);
  const capabilities = Object.entries(metadata.capabilities)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
    .sort();
  const parts = metadata.parts?.slice(0, 12).map((part) => ({
    kind: part.kind,
    ...(bound(part.searchableText, 80) === undefined
      ? {}
      : { summary: bound(part.searchableText, 80) }),
  }));
  return Object.freeze({
    handle,
    source: metadata.source === "PDF_BASE" ? "pdf" : "tldraw",
    kind: metadata.kind,
    ...(summary === undefined ? {} : { summary }),
    bounds: Object.freeze({
      x: clampUnit(metadata.bounds.x / pageSize.width),
      y: clampUnit(metadata.bounds.y / pageSize.height),
      width: clampUnit(metadata.bounds.width / pageSize.width),
      height: clampUnit(metadata.bounds.height / pageSize.height),
    }),
    capabilities: Object.freeze(capabilities),
    selected: context.selected,
    focused: context.focused,
    recent: context.recent,
    ...(parts === undefined || parts.length === 0
      ? {}
      : { parts: Object.freeze(parts) }),
  });
}

function projectionSource(
  ref: EntityRef,
  world: UnifiedObjectWorld,
): { readonly object: SceneObject; readonly metadata: SceneObjectMetadataView } | undefined {
  const objectId = ref.kind === "OBJECT" || ref.kind === "OBJECT_PART"
    ? ref.objectId
    : ref.kind === "TEXT_RANGE" ? ref.objectIds[0] : undefined;
  if (objectId === undefined) return undefined;
  const object = world.getObject(objectId);
  const metadata = world.getObjectMetadata(objectId);
  return object === undefined || metadata === undefined ? undefined : { object, metadata };
}

function appearanceFor(object: SceneObject): ObjectAppearanceSummary | undefined {
  if (object.kind === "shape") {
    return compactAppearance({
      fillColor: object.style.fill,
      strokeColor: object.style.stroke,
      opacity: object.style.opacity,
      strokeWidth: object.style.strokeWidth,
    });
  }
  if (object.kind === "annotation") {
    return compactAppearance({
      dominantColor: object.style.color,
      strokeColor: object.style.color,
      opacity: object.style.opacity,
      strokeWidth: object.style.thickness,
    });
  }
  if (object.kind === "text") {
    return compactAppearance({ fontSize: object.style.fontSize });
  }
  return undefined;
}

function compactAppearance(
  appearance: ObjectAppearanceSummary,
): ObjectAppearanceSummary | undefined {
  return Object.values(appearance).every((value) => value === undefined)
    ? undefined
    : Object.freeze(Object.fromEntries(
        Object.entries(appearance).filter(([, value]) => value !== undefined),
      ));
}

function semanticSummaryFor(object: SceneObject): ObjectSemanticSummary | undefined {
  switch (object.kind) {
    case "annotation": return Object.freeze({ annotationType: object.annotationType });
    case "math": return Object.freeze({ ...(object.layout === undefined ? {} : { mathType: object.layout }) });
    case "table": return Object.freeze({ rows: object.rows, columns: object.columns });
    default: return undefined;
  }
}

function safeSemantic(
  attributes: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (attributes === undefined) return undefined;
  const entries = Object.entries(attributes).filter(([key]) =>
    !/(?:^|_)(?:id|ids)$/iu.test(key) && !/(?:Id|Ids)$/u.test(key));
  return entries.length === 0 ? undefined : Object.freeze(Object.fromEntries(entries));
}

function cloneRef(ref: EntityRef): EntityRef {
  switch (ref.kind) {
    case "OBJECT": return { ...ref };
    case "PAGE": return { ...ref };
    case "OBJECT_PART": return {
      ...ref,
      ...(ref.bounds === undefined ? {} : { bounds: { ...ref.bounds } }),
    };
    case "TEXT_RANGE": return {
      ...ref,
      objectIds: [...ref.objectIds],
      rects: ref.rects.map(freezeRect),
    };
  }
}

function isHandle(value: string): boolean {
  return /^(?:O[1-9][0-9]*|(?:(?:selection|focus)(?::part:[1-9][0-9]*)?|recent:[1-9][0-9]*|candidate:[CS][1-9][0-9]*|viewport:V[1-9][0-9]*))$/u.test(value);
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

function bound(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= limit ? value : value.slice(0, limit);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

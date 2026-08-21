import {
  describeSceneObject,
  normalizeSceneObjectText,
  type SceneObject,
  type SceneObjectKind,
  type SceneSnapshot,
  type UnifiedSceneObjectSource,
} from "@ggulnote/editor-core";

export interface ObjectIndexEntry {
  readonly objectId: string;
  readonly documentId: string;
  readonly pageId: string;
  readonly kind: SceneObjectKind;
  readonly source: UnifiedSceneObjectSource;
  readonly searchableText?: string;
  readonly normalizedText?: string;
  readonly canonicalMath?: string;
  readonly semanticAttributes?: Readonly<Record<string, unknown>>;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly creationOrder?: number;
  readonly readingOrder?: number;
  readonly createdByTurnId?: string;
}

export type ObjectIndexSort =
  | "READING_ORDER"
  | "CREATION_ASC"
  | "CREATION_DESC";

export interface ObjectIndexQuery {
  readonly documentId?: string;
  readonly pageId?: string;
  readonly sceneRevision?: number;
  readonly kinds?: readonly SceneObjectKind[];
  readonly sources?: readonly UnifiedSceneObjectSource[];
  readonly text?: string;
  readonly canonicalMath?: string;
  readonly semanticAttributes?: Readonly<Record<string, unknown>>;
  readonly createdByTurnId?: string;
  readonly sort?: ObjectIndexSort;
  readonly limit?: number;
}

export interface ObjectIndexSnapshotState {
  readonly documentId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly contentHash: string;
  readonly entryCount: number;
}

export type ObjectIndexRebuildResult =
  | { readonly status: "REBUILT"; readonly state: ObjectIndexSnapshotState }
  | { readonly status: "UNCHANGED"; readonly state: ObjectIndexSnapshotState };

export interface ObjectIndexChanges {
  readonly documentId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly upserts?: readonly SceneObject[];
  readonly deletedObjectIds?: readonly string[];
}

export type ObjectIndexChangeResult =
  | { readonly status: "UPDATED"; readonly state: ObjectIndexSnapshotState }
  | { readonly status: "STALE_REVISION" }
  | { readonly status: "MISSING_BASE" };

interface MutablePageIndexState {
  documentId: string;
  pageId: string;
  sceneRevision: number;
  contentHash: string;
  entries: Map<string, ObjectIndexEntry>;
}

export class RebuildableObjectIndex {
  private readonly pages = new Map<string, MutablePageIndexState>();

  public rebuild(
    documentId: string,
    snapshot: SceneSnapshot,
  ): ObjectIndexRebuildResult {
    const entries = new Map(snapshot.objects.map((object) => {
      const entry = objectIndexEntryFromSceneObject(documentId, object);
      return [entry.objectId, entry] as const;
    }));
    const contentHash = objectIndexContentHash(entries.values());
    const key = pageKey(documentId, snapshot.page.id);
    const current = this.pages.get(key);
    if (
      current?.sceneRevision === snapshot.sceneRevision
      && current.contentHash === contentHash
    ) {
      return { status: "UNCHANGED", state: toSnapshotState(current) };
    }
    const next: MutablePageIndexState = {
      documentId,
      pageId: snapshot.page.id,
      sceneRevision: snapshot.sceneRevision,
      contentHash,
      entries,
    };
    this.pages.set(key, next);
    return { status: "REBUILT", state: toSnapshotState(next) };
  }

  public applyChanges(changes: ObjectIndexChanges): ObjectIndexChangeResult {
    const key = pageKey(changes.documentId, changes.pageId);
    const current = this.pages.get(key);
    if (current === undefined) return { status: "MISSING_BASE" };
    if (changes.sceneRevision < current.sceneRevision) {
      return { status: "STALE_REVISION" };
    }
    for (const objectId of changes.deletedObjectIds ?? []) {
      current.entries.delete(objectId);
    }
    for (const object of changes.upserts ?? []) {
      if (object.pageId !== changes.pageId) {
        throw new Error("ObjectIndex update object belongs to another page.");
      }
      const entry = objectIndexEntryFromSceneObject(changes.documentId, object);
      current.entries.set(entry.objectId, entry);
    }
    current.sceneRevision = changes.sceneRevision;
    current.contentHash = objectIndexContentHash(current.entries.values());
    return { status: "UPDATED", state: toSnapshotState(current) };
  }

  public search(query: ObjectIndexQuery = {}): readonly ObjectIndexEntry[] {
    const kinds = query.kinds === undefined ? undefined : new Set(query.kinds);
    const sources = query.sources === undefined
      ? undefined
      : new Set(query.sources);
    const normalizedText = query.text === undefined
      ? undefined
      : normalizeSceneObjectText(query.text);
    const entries = [...this.pages.values()]
      .filter((page) =>
        (query.documentId === undefined || page.documentId === query.documentId)
        && (query.pageId === undefined || page.pageId === query.pageId)
        && (
          query.sceneRevision === undefined
          || page.sceneRevision === query.sceneRevision
        ))
      .flatMap((page) => [...page.entries.values()])
      .filter((entry) =>
        (kinds === undefined || kinds.has(entry.kind))
        && (sources === undefined || sources.has(entry.source))
        && (
          normalizedText === undefined
          || entry.normalizedText?.includes(normalizedText) === true
        )
        && (
          query.canonicalMath === undefined
          || entry.canonicalMath === query.canonicalMath
        )
        && (
          query.createdByTurnId === undefined
          || entry.createdByTurnId === query.createdByTurnId
        )
        && attributesMatch(entry.semanticAttributes, query.semanticAttributes))
      .sort(indexComparator(query.sort ?? "READING_ORDER"));
    const limit = normalizeLimit(query.limit);
    return Object.freeze(entries.slice(0, limit).map(cloneObjectIndexEntry));
  }

  public getState(
    documentId: string,
    pageId: string,
  ): ObjectIndexSnapshotState | undefined {
    const state = this.pages.get(pageKey(documentId, pageId));
    return state === undefined ? undefined : toSnapshotState(state);
  }

  public invalidate(documentId: string, pageId: string): void {
    this.pages.delete(pageKey(documentId, pageId));
  }

  public clear(): void {
    this.pages.clear();
  }
}

export function objectIndexEntryFromSceneObject(
  documentId: string,
  object: SceneObject,
): ObjectIndexEntry {
  const metadata = describeSceneObject(object, { documentId });
  return Object.freeze({
    objectId: metadata.objectId,
    documentId,
    pageId: metadata.pageId,
    kind: metadata.kind,
    source: metadata.source,
    ...(metadata.searchableText === undefined
      ? {}
      : { searchableText: metadata.searchableText }),
    ...(metadata.normalizedText === undefined
      ? {}
      : { normalizedText: metadata.normalizedText }),
    ...(metadata.canonicalMath === undefined
      ? {}
      : { canonicalMath: metadata.canonicalMath }),
    ...(metadata.semanticAttributes === undefined
      ? {}
      : { semanticAttributes: Object.freeze({ ...metadata.semanticAttributes }) }),
    ...(metadata.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
    ...(metadata.updatedAt === undefined ? {} : { updatedAt: metadata.updatedAt }),
    ...(metadata.creationOrder === undefined
      ? {}
      : { creationOrder: metadata.creationOrder }),
    ...(metadata.readingOrder === undefined
      ? {}
      : { readingOrder: metadata.readingOrder }),
    ...(metadata.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: metadata.createdByTurnId }),
  });
}

function attributesMatch(
  actual: Readonly<Record<string, unknown>> | undefined,
  expected: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) =>
    stableValue(actual[key]) === stableValue(value));
}

function indexComparator(sort: ObjectIndexSort) {
  return (left: ObjectIndexEntry, right: ObjectIndexEntry): number => {
    if (sort === "CREATION_DESC") {
      return compareOptionalNumberDescending(
        left.creationOrder ?? left.createdAt,
        right.creationOrder ?? right.createdAt,
      )
        || left.objectId.localeCompare(right.objectId);
    }
    if (sort === "CREATION_ASC") {
      return compareOptionalNumber(left.creationOrder ?? left.createdAt, right.creationOrder ?? right.createdAt)
        || left.objectId.localeCompare(right.objectId);
    }
    return compareOptionalNumber(left.readingOrder, right.readingOrder)
      || compareOptionalNumber(left.creationOrder ?? left.createdAt, right.creationOrder ?? right.createdAt)
      || left.objectId.localeCompare(right.objectId);
  };
}

function compareOptionalNumberDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function cloneObjectIndexEntry(entry: ObjectIndexEntry): ObjectIndexEntry {
  return {
    ...entry,
    ...(entry.semanticAttributes === undefined
      ? {}
      : { semanticAttributes: { ...entry.semanticAttributes } }),
  };
}

function objectIndexContentHash(entries: Iterable<ObjectIndexEntry>): string {
  const serialized = [...entries]
    .sort((left, right) => left.objectId.localeCompare(right.objectId))
    .map((entry) => stableValue(entry))
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("ObjectIndex query limit must be a non-negative integer.");
  }
  return limit;
}

function pageKey(documentId: string, pageId: string): string {
  return `${encodeURIComponent(documentId)}:${encodeURIComponent(pageId)}`;
}

function toSnapshotState(state: MutablePageIndexState): ObjectIndexSnapshotState {
  return Object.freeze({
    documentId: state.documentId,
    pageId: state.pageId,
    sceneRevision: state.sceneRevision,
    contentHash: state.contentHash,
    entryCount: state.entries.size,
  });
}

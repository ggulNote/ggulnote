import {
  describeSceneObject,
  type SceneObject,
  type SceneObjectMetadataView,
  type SceneSnapshot,
} from "@ggulnote/editor-core";
import type {
  FrozenPageGroundingSnapshot,
  FrozenSceneSnapshotReference,
} from "../../domain";
import type { FrozenSceneSnapshotSource } from "../../application";
import type { EntityRef } from "./entity-ref";
import {
  RebuildableObjectIndex,
  type ObjectIndexQuery,
  type ObjectIndexEntry,
} from "./object-index";
import {
  type NoteOperationLedger,
  type OperationLedgerRecord,
  type OperationLedgerQuery,
} from "./operation-ledger";

export interface UnifiedObjectWorldSnapshot {
  readonly documentId: string;
  readonly scene: SceneSnapshot;
}

export interface UnifiedObjectWorldSnapshotSource {
  getSnapshot(
    reference: FrozenSceneSnapshotReference,
  ): UnifiedObjectWorldSnapshot | undefined;
}

export interface UnifiedObjectWorld {
  getSnapshot(pageId: string, sceneRevision: number): SceneSnapshot | undefined;
  getObject(objectId: string): SceneObject | undefined;
  getObjectMetadata(objectId: string): SceneObjectMetadataView | undefined;
  listPageObjects(pageId: string): readonly SceneObject[];
  searchIndex(query: ObjectIndexQuery): readonly ObjectIndexEntry[];
  getRecentOperations?(query: OperationLedgerQuery): readonly OperationLedgerRecord[];
  getRecentOperationOutputs(query: OperationLedgerQuery): readonly EntityRef[];
}

export interface ExistingUnifiedObjectWorldOptions {
  readonly snapshotSource: UnifiedObjectWorldSnapshotSource;
  readonly operationLedger: NoteOperationLedger;
  readonly objectIndex?: RebuildableObjectIndex;
}

interface CachedPageSnapshot extends UnifiedObjectWorldSnapshot {}

export class ExistingUnifiedObjectWorld implements UnifiedObjectWorld {
  private readonly objectIndex: RebuildableObjectIndex;
  private readonly pages = new Map<string, CachedPageSnapshot>();

  public constructor(private readonly options: ExistingUnifiedObjectWorldOptions) {
    this.objectIndex = options.objectIndex ?? new RebuildableObjectIndex();
  }

  public getSnapshot(
    pageId: string,
    sceneRevision: number,
  ): SceneSnapshot | undefined {
    const loaded = this.options.snapshotSource.getSnapshot({
      pageId,
      sceneRevision,
    });
    if (
      loaded === undefined
      || loaded.scene.page.id !== pageId
      || loaded.scene.sceneRevision !== sceneRevision
    ) {
      return undefined;
    }
    this.pages.set(pageId, loaded);
    this.objectIndex.rebuild(loaded.documentId, loaded.scene);
    return loaded.scene;
  }

  public getObject(objectId: string): SceneObject | undefined {
    for (const page of this.pages.values()) {
      const object = page.scene.objectById[objectId];
      if (object !== undefined) return object;
    }
    return undefined;
  }

  public getObjectMetadata(
    objectId: string,
  ): SceneObjectMetadataView | undefined {
    for (const page of this.pages.values()) {
      const object = page.scene.objectById[objectId];
      if (object !== undefined) {
        return describeSceneObject(object, { documentId: page.documentId });
      }
    }
    return undefined;
  }

  public listPageObjects(pageId: string): readonly SceneObject[] {
    return Object.freeze([...(this.pages.get(pageId)?.scene.objects ?? [])]);
  }

  public searchIndex(query: ObjectIndexQuery): readonly ObjectIndexEntry[] {
    return this.objectIndex.search(query);
  }

  public getRecentOperationOutputs(
    query: OperationLedgerQuery,
  ): readonly EntityRef[] {
    return this.options.operationLedger.getRecentOutputs(query);
  }

  public getRecentOperations(
    query: OperationLedgerQuery,
  ): readonly OperationLedgerRecord[] {
    return this.options.operationLedger.list(query);
  }
}

export class ExistingSceneUnifiedObjectWorldSource
implements UnifiedObjectWorldSnapshotSource {
  public constructor(private readonly source: FrozenSceneSnapshotSource) {}

  public getSnapshot(
    reference: FrozenSceneSnapshotReference,
  ): UnifiedObjectWorldSnapshot | undefined {
    const snapshot: FrozenPageGroundingSnapshot | undefined =
      this.source.getSnapshot(reference);
    return snapshot?.documentId === undefined
      ? undefined
      : { documentId: snapshot.documentId, scene: snapshot.scene };
  }
}

export { cloneEntityRef } from "./entity-ref";
export type { EntityRef } from "./entity-ref";
export { DeterministicPartResolver } from "./part-resolver";
export type { PartResolutionResult } from "./part-resolver";
export {
  ActionTargetResolver,
  objectLocalPointToCanvasPoint,
  objectLocalRegionToCanvasBounds,
  pageNormalizedPointToCanvasPoint,
} from "./action-target-resolver";
export type {
  ActionTargetGroundingMode,
  ActionTargetHandleLookup,
  ActionTargetResolution,
  ActionTargetResolverOptions,
  ResolvedActionTarget,
} from "./action-target-resolver";
export {
  objectIndexEntryFromSceneObject,
  RebuildableObjectIndex,
} from "./object-index";
export type {
  ObjectIndexChangeResult,
  ObjectIndexChanges,
  ObjectIndexEntry,
  ObjectIndexQuery,
  ObjectIndexRebuildResult,
  ObjectIndexSnapshotState,
  ObjectIndexSort,
} from "./object-index";
export {
  CompositeNoteOperationLedger,
  DirectCommandOperationLedgerAdapter,
  InMemoryNoteOperationLedger,
} from "./operation-ledger";
export type {
  DirectCommandOperationLedgerAdapterOptions,
  DirectOperationRecordSource,
  OperationLedgerQuery,
  OperationLedgerRecord,
  NoteOperationLedger,
} from "./operation-ledger";
export {
  ExistingSceneUnifiedObjectWorldSource,
  ExistingUnifiedObjectWorld,
} from "./unified-object-world";
export {
  capabilitiesForRef,
  ExistingWorldResolver,
} from "./world-resolver";
export type {
  ExistingWorldResolverOptions,
  FrozenWorldContext,
  WorldResolutionCandidate,
  WorldResolutionResult,
} from "./world-resolver";
export type {
  ExistingUnifiedObjectWorldOptions,
  UnifiedObjectWorld,
  UnifiedObjectWorldSnapshot,
  UnifiedObjectWorldSnapshotSource,
} from "./unified-object-world";

export type { EditorSnapshot, PageSceneSnapshot } from "./engine/editor-snapshot";
export { EditorEngine, DEFAULT_HISTORY_LIMIT } from "./engine/editor-engine";
export type { EditorOperation } from "./operations/editor-operation";
export type { EditorEvents, EditorPersistenceEvent, EditorHistoryAction } from "./engine/editor-events";
export type { EditorOptions } from "./engine/editor-options";

export type { AnnotationId, DocumentId, PageId } from "@ggulnote/shared-types";
export type { NormalizedPoint, NormalizedRect, Size } from "@ggulnote/shared-types";

export type { Annotation } from "./annotations/annotation";
export type { AnnotationType, CreateAnnotationInput } from "./annotations/annotation-types";
export { AnnotationFactory } from "./annotations/annotation-factory";
export type { AnnotationFactoryOptions } from "./annotations/annotation-factory";
export {
  DEFAULT_ANNOTATION_STYLE,
  MAX_ANNOTATION_RECT_COUNT,
} from "./annotations/annotation-types";
export {
  normalizeAnnotationRects,
  unionAnnotationRects,
} from "./geometry/multi-rect-geometry";

export type { EditorCommand, EditorCommandContext } from "./commands/editor-command";
export type { AnnotationRenderer, RenderFrameContext } from "./rendering/annotation-renderer";

export { PageScene } from "./scene/page-scene";
export { SceneStore } from "./scene/scene-store";
export { CommandManager } from "./commands/command-manager";

export { TextAnnotation } from "./annotations/text-annotation";
export { UnderlineAnnotation } from "./annotations/underline-annotation";
export { HighlightAnnotation } from "./annotations/highlight-annotation";
export { ShapeAnnotation } from "./annotations/shape-annotation";
export { LineAnnotation } from "./annotations/line-annotation";
export { TableAnnotation } from "./annotations/table-annotation";

export { serializeAnnotation, deserializeAnnotation } from "./serialization/annotation-serializer";
export type { SerializedAnnotation } from "./serialization/serialized-annotation";

export { CreateAnnotationCommand } from "./commands/create-annotation-command";
export { DeleteAnnotationCommand } from "./commands/delete-annotation-command";
export { MoveAnnotationCommand } from "./commands/move-annotation-command";
export { UpdateAnnotationCommand } from "./commands/update-annotation-command";


export * from './scene-core/types';
export { buildPdfSceneObjects } from './scene-core/pdf-scene-adapter';
export { buildCanvasSceneObjects, resolveCanvasGroupBounds } from './scene-core/canvas-scene-adapter';
export { CanvasObjectStore } from './scene-core/canvas-object-store';
export { buildSceneSnapshot, type SceneSnapshotWithStats } from './scene-core/scene-snapshot';
export { createSceneRevisionTracker } from './scene-core/revision';
export { buildOccupancyMap } from './scene-core/occupancy';
export { buildPlacementCandidates } from './scene-core/placement';
export { validatePlacementRequest } from './scene-core/placement-validator';
export { buildSceneContext } from './scene-core/scene-context';
export { buildCompositeRenderSnapshot } from './scene-core/composite-render';
export { InMemoryCapabilityRegistry, createCapabilityRegistry, createRegistryFactory } from './scene-core/capability-registry';
export {
  canonicalToNormalizedRect,
  clampRectToPage,
  normalizedToCanonicalRect,
  pagePointToScreenPoint,
  pageRectToScreenRect,
  screenPointToPagePoint,
  screenRectToPageRect,
} from './scene-core/coordinate';
export type { CanonicalPageDimensions, ScreenViewport } from './scene-core/coordinate';



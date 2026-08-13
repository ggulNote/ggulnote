import type { PageId, Point, Rect, Size } from "@ggulnote/shared-types";
export type { Point, Rect, Size } from "@ggulnote/shared-types";

export type SceneObjectSource = "pdf" | "canvas";

export type SceneObjectKind =
  | "pdf-region"
  | "paragraph"
  | "line"
  | "word"
  | "image"
  | "text"
  | "math"
  | "graph"
  | "table"
  | "shape"
  | "annotation"
  | "group";

export type SceneMode = "pdf" | "blank";

export interface BaseSceneObject {
  id: string;
  pageId: PageId;
  source: SceneObjectSource;
  sourceObjectId?: string;
  kind: SceneObjectKind;
  bounds: Rect;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  objectRevision: number;
  parentId?: string;
  groupId?: string;
  createdAt?: number;
  updatedAt?: number;
  createdByTurnId?: string;
  creationOrder?: number;
  renderBounds?: Rect;
}

export interface PdfRegionSceneObject extends BaseSceneObject {
  kind: "pdf-region";
  source: "pdf";
  regionId: string;
  regionType: string;
  regionBounds: Rect;
  relatedSemanticObjectIds: string[];
  pageIndex: number;
  confidence?: number;
  sourceRef?: string;
}

export interface ParagraphSceneObject extends BaseSceneObject {
  kind: "paragraph";
  source: "pdf";
  sourceObjectId: string;
  text: string;
  readingOrder: number;
  childLineIds: string[];
  regionId: string;
}

export interface LineSceneObject extends BaseSceneObject {
  kind: "line";
  source: "pdf";
  sourceObjectId: string;
  text: string;
  readingOrder: number;
  childWordIds: string[];
  paragraphId: string | null;
  baseline?: number;
}

export interface WordSceneObject extends BaseSceneObject {
  kind: "word";
  source: "pdf";
  sourceObjectId: string;
  text: string;
  readingOrder: number;
  lineId: string;
  charOffsetStart: number;
  charOffsetEnd: number;
}

export interface ImageSceneObject extends BaseSceneObject {
  kind: "image";
  source: "pdf" | "canvas";
  sourceObjectId: string;
  imageId: string;
  imageSource?: string;
  sourceAssetId?: string;
  assetUrl?: string;
}

export interface TextSceneObject extends BaseSceneObject {
  kind: "text";
  source: "canvas";
  sourceObjectId?: string;
  text: string;
  style: {
    fontFamily?: string;
    fontSize: number;
    fontWeight?: number | string;
    lineHeight?: number;
    textAlign?: "left" | "center" | "right";
  };
}

export interface MathSceneObject extends BaseSceneObject {
  kind: "math";
  source: "canvas";
  latex: string;
  mathJson?: unknown;
  layout?: "inline" | "display" | "equation-stack" | "long-multiplication" | "long-division";
}

export interface GraphSceneObject extends BaseSceneObject {
  kind: "graph";
  source: "canvas";
  expressions: Array<{
    id: string;
    expression: string;
  }>;
  viewport: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  showAxes: boolean;
  showGrid: boolean;
}

export interface TableSceneObject extends BaseSceneObject {
  kind: "table";
  source: "pdf" | "canvas";
  rows: number;
  columns: number;
  cells: Array<{
    id: string;
    row: number;
    column: number;
    rowSpan?: number;
    columnSpan?: number;
    text?: string;
  }>;
  rowHeights?: number[];
  columnWidths?: number[];
}

export type ShapeGeometry =
  | {
      kind: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "ellipse";
      centerX: number;
      centerY: number;
      radiusX: number;
      radiusY: number;
    }
  | {
      kind: "line";
      start: Point;
      end: Point;
    }
  | {
      kind: "arrow";
      start: Point;
      end: Point;
      headSize: number;
    }
  | {
      kind: "triangle";
      points: [Point, Point, Point];
    }
  | {
      kind: "polygon";
      points: Point[];
    };

export interface ShapeSceneObject extends BaseSceneObject {
  kind: "shape";
  source: "canvas";
  shapeType: "rectangle" | "ellipse" | "line" | "arrow" | "triangle" | "polygon";
  geometry: ShapeGeometry;
  style: {
    strokeWidth?: number;
    fill?: string;
    stroke?: string;
    opacity?: number;
  };
}

export interface AnnotationSceneObject extends BaseSceneObject {
  kind: "annotation";
  source: "canvas";
  annotationType: "underline" | "highlight" | "strikethrough" | "box" | "emphasis";
  targetObjectIds: string[];
  rects?: readonly Rect[];
  style: {
    color?: string;
    opacity?: number;
    thickness?: number;
  };
}

export interface GroupSceneObject extends BaseSceneObject {
  kind: "group";
  source: "canvas";
  childIds: string[];
}

export type SceneObject =
  | PdfRegionSceneObject
  | ParagraphSceneObject
  | LineSceneObject
  | WordSceneObject
  | ImageSceneObject
  | TextSceneObject
  | MathSceneObject
  | GraphSceneObject
  | TableSceneObject
  | ShapeSceneObject
  | AnnotationSceneObject
  | GroupSceneObject;

export type PdfSceneObject =
  | PdfRegionSceneObject
  | ParagraphSceneObject
  | LineSceneObject
  | WordSceneObject
  | ImageSceneObject
  | TableSceneObject;

export type CanvasSceneObject =
  | TextSceneObject
  | MathSceneObject
  | GraphSceneObject
  | TableSceneObject
  | ShapeSceneObject
  | AnnotationSceneObject
  | ImageSceneObject
  | GroupSceneObject;

export type NewCanvasTextObject = Omit<TextSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasMathObject = Omit<MathSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasGraphObject = Omit<GraphSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasTableObject = Omit<TableSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasShapeObject = Omit<ShapeSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasAnnotationObject = Omit<AnnotationSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasImageObject = Omit<ImageSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasGroupObject = Omit<GroupSceneObject, "id" | "objectRevision" | "createdAt" | "updatedAt"> & {
  id?: string;
  objectRevision?: never;
  source: "canvas";
};

export type NewCanvasObject =
  | NewCanvasTextObject
  | NewCanvasMathObject
  | NewCanvasGraphObject
  | NewCanvasTableObject
  | NewCanvasShapeObject
  | NewCanvasAnnotationObject
  | NewCanvasImageObject
  | NewCanvasGroupObject;

export type CanvasObjectPatch = Partial<
  Omit<CanvasSceneObject, "id" | "pageId" | "source" | "kind" | "objectRevision" | "createdAt">
>;

export interface ScenePage {
  id: string;
  index: number;
  width: number;
  height: number;
}

export interface SceneSnapshot {
  sceneRevision: number;
  mode: SceneMode;
  page: ScenePage;
  objects: SceneObject[];
  objectById: Readonly<Record<string, SceneObject>>;
  renderOrder: string[];
  generatedAt: number;
}

export interface SceneFocus {
  objectId?: string;
  bounds?: Rect;
}

export interface SceneContext {
  sceneRevision: number;
  mode: SceneMode;
  page: ScenePage;
  focus?: SceneFocus;
  objects: SceneObject[];
  occupancyMap: OccupancyMap;
  placementCandidates: PlacementCandidate[];
}

export interface OccupancyObject {
  objectId: string;
  kind: SceneObjectKind;
  bounds: Rect;
  blocking: boolean;
}

export interface OccupancyPolicy {
  includeInvisible: boolean;
  includeAnnotations: boolean;
  annotationBlockingTypes: Array<AnnotationSceneObject["annotationType"]>;
  padding: number;
  minimumBlockingSize: Size;
}

export interface OccupancyMap {
  sceneRevision: number;
  pageBounds: Rect;
  objects: OccupancyObject[];
}

export type PlacementRelation =
  | "PAGE_FREE_SPACE"
  | "ABOVE_FOCUS"
  | "BELOW_FOCUS"
  | "LEFT_OF_FOCUS"
  | "RIGHT_OF_FOCUS";

export interface PlacementCandidate {
  id: string;
  sceneRevision: number;
  relation: PlacementRelation;
  bounds: Rect;
  area: number;
  score: number;
  nearbyObjectIds: string[];
}

export interface PlacementRequest {
  sceneRevision: number;
  candidateId: string;
  alignment:
    | "TOP_LEFT"
    | "TOP_CENTER"
    | "CENTER"
    | "BOTTOM_LEFT"
    | "BOTTOM_CENTER";
  sizePolicy: "FIT_CONTENT" | "FIT_CANDIDATE" | "FIXED";
  requestedSize?: Size;
}

export type PlacementValidationResult =
  | {
      valid: true;
      resolvedBounds: Rect;
    }
  | {
      valid: false;
      reason:
        | "SCENE_REVISION_MISMATCH"
        | "CANDIDATE_NOT_FOUND"
        | "OUT_OF_PAGE"
        | "COLLISION"
        | "INSUFFICIENT_SPACE"
        | "INVALID_SIZE";
    };

export interface SceneObjectPlacementPolicy {
  minimumCandidateWidth: number;
  minimumCandidateHeight: number;
  allowOutOfPage: boolean;
  minimumCollisionArea: number;
  scoreWeightArea: number;
  scoreWeightFocusDistance: number;
  scoreWeightEdgeDistance: number;
  scoreWeightWhitespace: number;
  annotationBlockingTypes?: Array<AnnotationSceneObject["annotationType"]>;
}

export const DEFAULT_PLACEMENT_POLICY: SceneObjectPlacementPolicy = {
  minimumCandidateWidth: 8,
  minimumCandidateHeight: 8,
  allowOutOfPage: false,
  minimumCollisionArea: 0,
  scoreWeightArea: 1,
  scoreWeightFocusDistance: 0.35,
  scoreWeightEdgeDistance: 0.25,
  scoreWeightWhitespace: 0.4,
};

export interface PlacementValidationInput {
  request: PlacementRequest;
  scene: SceneSnapshot;
  candidates: readonly PlacementCandidate[];
  policy: SceneObjectPlacementPolicy;
}

export interface CapabilityContext {
  sceneRevision: number;
  page: ScenePage;
  occupancyMap: OccupancyMap;
  placementCandidates: PlacementCandidate[];
}

export type CapabilityId =
  | "annotation"
  | "text"
  | "table"
  | "math"
  | "graph"
  | "shape"
  | "navigation";

export interface VoiceCapability<TCommand = unknown, TAction = unknown> {
  id: CapabilityId;
  estimateFootprint(command: TCommand): Size;
  validatePlacement(candidate: PlacementCandidate, scene: SceneSnapshot): PlacementValidationResult;
  compile(command: TCommand, context: CapabilityContext): TAction;
}

export interface CapabilityRegistry {
  register(capability: VoiceCapability): void;
  unregister(id: CapabilityId): void;
  get(id: CapabilityId): VoiceCapability | undefined;
  list(): VoiceCapability[];
}

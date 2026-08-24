import type { SceneObjectKind } from "@ggulnote/editor-core";

export const NOTE_SPATIAL_RELATIONS = [
  "ABOVE", "BELOW", "LEFT_OF", "RIGHT_OF", "BESIDE", "NEAR",
  "INSIDE", "OVERLAPS", "BETWEEN", "SAME_ROW", "SAME_COLUMN",
] as const;

export type NoteSpatialRelation = (typeof NOTE_SPATIAL_RELATIONS)[number];

export const NOTE_PAGE_REGIONS = [
  "TOP_LEFT", "TOP", "TOP_RIGHT", "LEFT", "CENTER", "RIGHT",
  "BOTTOM_LEFT", "BOTTOM", "BOTTOM_RIGHT", "MARGIN",
] as const;

export type NotePageRegion = (typeof NOTE_PAGE_REGIONS)[number];
export type EntitySelectorScope = "CURRENT_VIEW" | "CURRENT_PAGE" | "DOCUMENT";
export type EntitySelectorSource = "PDF_BASE" | "USER_CREATED" | "ANY";
export type EntitySelectorTemporal = "RECENT" | "FIRST_CREATED" | "LAST_CREATED";
export type EntitySelectorContext = "FOCUS" | "SELECTION";

export const NOTE_OBJECT_PART_KINDS = [
  "curve", "point", "tangent", "row", "column", "cell", "expression", "subexpression",
  "text_range",
] as const;

export type NoteObjectPartKind = (typeof NOTE_OBJECT_PART_KINDS)[number];

/** Declarative part criteria. Runtime resolves the real partId deterministically. */
export interface EntityPartSelector {
  readonly kind: NoteObjectPartKind;
  readonly index?: number;
  readonly row?: number;
  readonly column?: number;
  readonly text?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export interface EntitySelectorContent {
  readonly text?: string;
  readonly math?: string;
  readonly semantic?: string;
}

export interface EntitySelector {
  readonly scope?: EntitySelectorScope;
  readonly kinds?: readonly SceneObjectKind[];
  readonly source?: EntitySelectorSource;
  readonly content?: EntitySelectorContent;
  readonly attributes?: Readonly<Record<string, JsonValue>>;
  readonly temporal?: EntitySelectorTemporal;
  readonly ordinal?: number | "FIRST" | "LAST";
  readonly context?: EntitySelectorContext;
  readonly spatial?: readonly SpatialConstraint[];
  readonly part?: EntityPartSelector;
}

export type SpatialReference =
  | { readonly kind: "ENTITY"; readonly selector: EntitySelector }
  | { readonly kind: "PAGE_REGION"; readonly region: NotePageRegion }
  | { readonly kind: "FOCUS" }
  | { readonly kind: "SELECTION" };

export interface SpatialConstraint {
  readonly relation: NoteSpatialRelation;
  readonly reference: SpatialReference;
}

export type NoteAlignment = "START" | "CENTER" | "END" | "AUTO";

/** Legacy EditorNoteAgentTransaction destination; production READY steps use CanvasPlacement. */
export type Destination =
  | {
      readonly kind: "PAGE_REGION";
      readonly region: NotePageRegion;
      readonly alignment?: NoteAlignment;
      readonly avoidOverlap?: boolean;
    }
  | {
      readonly kind: "RELATIVE";
      readonly relation: NoteSpatialRelation;
      readonly anchor: EntitySelector | { readonly context: EntitySelectorContext };
      readonly alignment?: NoteAlignment;
      readonly distance?: "NEAR" | "NORMAL";
      readonly avoidOverlap?: boolean;
    };

export type NoteToolId = `${string}.${string}`;
export type NoteToolKind = "QUERY" | "COMPUTE" | "MUTATION";

export interface CompactToolSchema {
  readonly id: NoteToolId;
  readonly kind: NoteToolKind;
  readonly description: string;
  readonly examples?: readonly string[];
  readonly input?: Readonly<Record<string, string>>;
  readonly strictArgs?: Readonly<Record<string, JsonValue>>;
}

export const NOTE_CONTEXT_PART_IDS = [
  "user-turn",
  "frozen-context",
  "object-catalog",
  "selection-focus",
  "recent-operations",
  "object-detail",
  "candidates",
  "screenshot-crop",
] as const;

export type NoteContextPartId = (typeof NOTE_CONTEXT_PART_IDS)[number];

/** Request-local, ordered projection sent to the single Decision call. */
export interface DecisionContextFragment {
  readonly id: NoteContextPartId;
  readonly priority: number;
  readonly content: JsonValue;
}

export interface NoteDecisionInput {
  readonly turn: {
    readonly turnId: string;
    readonly language: string;
    readonly rawFinalTranscript: string;
  };
  readonly frozenContext: {
    readonly documentId: string;
    readonly pageId: string;
    readonly sceneRevision: number;
    readonly sceneMode: "pdf" | "blank";
    readonly selection?: NoteContextSummary;
    readonly focus?: NoteContextSummary;
    readonly lastOperation?: {
      readonly toolId: NoteToolId;
      readonly outputKind?: string;
      readonly summary?: string;
    };
  };
  readonly availableTools: readonly CompactToolSchema[];
  readonly pageBase: PageBaseSnapshot;
  readonly liveScene: LiveSceneContext;
  /**
   * Compatibility view for local validation and handle lookup. Model prompts
   * use pageBase + liveScene instead of serializing this merged world.
   */
  readonly objectCatalog: {
    readonly objects: readonly NoteCatalogObject[];
    readonly truncated: boolean;
  };
  /** Optional agent-only marked visual evidence tied to the shared object handle world. */
  readonly visualContext?: {
    readonly mimeType: "image/png" | "image/jpeg";
    readonly imageDataUrl: string;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly byteLength: number;
    readonly markedObjects: readonly {
      readonly objectId: ObjectHandle;
      readonly kind: SceneObjectKind;
      /** Page-normalized bounds used to draw the marker in the agent screenshot. */
      readonly bounds: NoteCatalogObject["bounds"];
    }[];
  };
}

export interface NotePageBaseWarmupInput {
  readonly availableTools: readonly CompactToolSchema[];
  readonly pageBase: PageBaseSnapshot;
  readonly contextRevision: number;
}

export interface NoteDecisionVisualWarmupInput {
  readonly turnId: string;
  readonly contextRevision: number;
  /** The exact frozen Decision payload whose visual prefix will be reused later. */
  readonly decisionInput: NoteDecisionInput;
}

export type NoteDecisionWarmupInput =
  | NotePageBaseWarmupInput
  | NoteDecisionVisualWarmupInput;

export type ObjectHandle = `O${number}`;

export interface NoteCatalogObject {
  readonly handle: ObjectHandle;
  readonly source: "pdf" | "tldraw";
  readonly kind: SceneObjectKind;
  readonly text?: string;
  readonly summary?: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly capabilities: readonly string[];
  readonly selected: boolean;
  readonly focused: boolean;
  readonly recent: boolean;
  readonly parts?: readonly {
    readonly kind: string;
    readonly summary?: string;
  }[];
}

/** Immutable, cache-friendly world captured from persisted state on page activation. */
export interface PageBaseSnapshot {
  readonly documentId: string;
  readonly pageId: string;
  readonly baseRevision: string;
  readonly sceneMode: "pdf" | "blank";
  readonly objects: readonly NoteCatalogObject[];
  readonly pageText?: string;
  readonly createdAt: number;
}

/** Dynamic context appended after PageBaseSnapshot for every Decision. */
export interface LiveSceneContext {
  readonly sceneRevision: number;
  readonly createdObjects: readonly NoteCatalogObject[];
  readonly updatedObjects: readonly NoteCatalogObject[];
  readonly deletedObjectIds: readonly ObjectHandle[];
  readonly selectedObjectIds: readonly ObjectHandle[];
  readonly focusedObjectId?: ObjectHandle;
  readonly recentObjectIds: readonly ObjectHandle[];
  readonly lastOperation?: NoteDecisionInput["frozenContext"]["lastOperation"];
}

export interface NoteContextSummary {
  readonly kind?: string;
  readonly textPreview?: string;
  readonly semanticPreview?: string;
}

export interface NoteToolCall {
  readonly stepId: string;
  readonly toolId: NoteToolId;
  readonly input: unknown;
}

export interface DecisionObjectPartRef {
  readonly kind: NoteObjectPartKind;
  readonly index?: number | null;
  readonly row?: number | null;
  readonly column?: number | null;
  readonly text?: string | null;
  readonly startText?: string | null;
  readonly endText?: string | null;
}

export interface ActionTargetRegion {
  /** Object-local normalized coordinates in the [0, 1] range. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ActionTargetFallbackPoint {
  readonly x: number;
  readonly y: number;
  /** PAGE remains usable when the requested object no longer exists. */
  readonly coordinateSpace: "OBJECT_LOCAL" | "PAGE";
}

/**
 * One model-owned target. Runtime only validates the handle and transforms its
 * normalized visual coordinates into current canvas geometry.
 */
export interface ActionTarget {
  readonly object: ObjectHandle | null;
  readonly part: DecisionObjectPartRef | null;
  readonly region?: ActionTargetRegion | null;
  readonly fallbackPoint?: ActionTargetFallbackPoint | null;
}

/** Compatibility name retained for existing registered action adapters. */
export type DecisionObjectRef = ActionTarget;

/** Final page-local placement selected by the multimodal Decision. */
export interface CanvasPlacement {
  /** Normalized top-left x in page coordinates. */
  readonly x: number;
  /** Normalized top-left y in page coordinates. */
  readonly y: number;
  /** Optional normalized width. Null keeps the renderer-measured width. */
  readonly width: number | null;
  /** Optional normalized height. Null keeps the renderer-measured height. */
  readonly height: number | null;
}

export interface DecisionStep {
  readonly action: NoteToolId;
  readonly target: DecisionObjectRef | null;
  readonly args: Readonly<Record<string, JsonValue>>;
  /** Present only for actions that create a canvas object. */
  readonly placement?: CanvasPlacement | null;
}

export type ClarificationReason =
  | "AMBIGUOUS_OBJECT"
  | "MISSING_TARGET"
  | "VISUAL_UNRESOLVED"
  | "CONTEXT_LIMIT";

export interface CropRequest {
  readonly mode: "CANDIDATE_UNION";
  readonly padding: number;
}

/** The runtime binds only already-completed step values before schema parsing. */
export interface StepResultRef {
  readonly fromStep: string;
  readonly path?: readonly string[];
}

export type NoteDecision =
  | {
      readonly status: "READY";
      readonly sceneRevision: number;
      readonly steps: readonly DecisionStep[];
    }
  | {
      readonly status: "NEEDS_CLARIFICATION";
      readonly sceneRevision: number;
      readonly reason: ClarificationReason;
    }
  | {
      readonly status: "NOT_ALLOWED";
      readonly sceneRevision: number;
      readonly reason: string;
    }
  // Compatibility variants remain parser-only for shadow fixtures. Production
  // schemas never expose NEEDS_VISUAL because the initial image is the only pass.
  | {
      readonly status: "NEEDS_VISUAL";
      readonly sceneRevision: number;
      readonly candidateHandles: readonly ObjectHandle[];
      readonly cropRegion: CropRequest;
    }
  | { readonly status: "CALL"; readonly call: NoteToolCall }
  | { readonly status: "BATCH"; readonly atomic: true; readonly steps: readonly NoteToolCall[] }
  | { readonly status: "NEEDS_INPUT"; readonly missing: readonly string[] }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string }
  | { readonly status: "NO_OP" };

export const NOTE_DECISION_MAX_BATCH_STEPS = 4;
export const NOTE_SELECTOR_MAX_DEPTH = 2;

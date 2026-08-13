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
  readonly input: Readonly<Record<string, string>>;
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

export interface NoteDisambiguationCandidate {
  readonly alias: `${"C" | "S"}${number}`;
  readonly kind?: string;
  readonly source?: string;
  readonly textPreview?: string;
}

export interface NoteDisambiguationInput {
  readonly turnId: string;
  readonly language: string;
  readonly rawFinalTranscript: string;
  readonly stepId: string;
  readonly toolId: NoteToolId;
  readonly candidates: readonly NoteDisambiguationCandidate[];
}

export type NoteDisambiguationChoice =
  | { readonly status: "SELECTED"; readonly alias: NoteDisambiguationCandidate["alias"] }
  | { readonly status: "NONE" };

export type NoteDecision =
  | { readonly status: "CALL"; readonly call: NoteToolCall }
  | { readonly status: "BATCH"; readonly atomic: true; readonly steps: readonly NoteToolCall[] }
  | { readonly status: "NEEDS_INPUT"; readonly missing: readonly string[] }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string }
  | { readonly status: "NO_OP" };

export const NOTE_DECISION_MAX_BATCH_STEPS = 4;
export const NOTE_SELECTOR_MAX_DEPTH = 2;

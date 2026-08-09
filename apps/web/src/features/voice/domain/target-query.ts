import type { SceneObjectKind } from "@ggulnote/editor-core";

export const DIRECT_TARGET_OBJECT_TYPES = [
  "pdf-region",
  "paragraph",
  "line",
  "word",
  "image",
  "text",
  "math",
  "graph",
  "table",
  "shape",
  "annotation",
  "group",
] as const satisfies readonly SceneObjectKind[];

export type DirectTargetObjectType = (typeof DIRECT_TARGET_OBJECT_TYPES)[number];

export const DIRECT_SEMANTIC_UNITS = ["sentence", "paragraph", "line"] as const;

export type DirectSemanticUnit = (typeof DIRECT_SEMANTIC_UNITS)[number];

export interface TextSpanTargetQuery {
  kind: "text_span";
  quote?: string;
  startAnchor?: string;
  endAnchor?: string;
}

export interface SemanticUnitTargetQuery {
  kind: "semantic_unit";
  unit: DirectSemanticUnit;
  query?: string;
  relation?: "focused";
}

export interface ObjectTargetQuery {
  kind: "object";
  objectType: DirectTargetObjectType;
  query?: string;
  relation?: "focused" | "recent" | "last_target";
}

export interface RelativeTargetQuery {
  kind: "relative";
  relation: "focused" | "last_target" | "recent";
  objectType?: DirectTargetObjectType;
}

export interface SubrangeTargetQuery {
  kind: "subrange";
  parent: TargetQuery;
  query: string;
}

export type TargetQuery =
  | TextSpanTargetQuery
  | SemanticUnitTargetQuery
  | ObjectTargetQuery
  | RelativeTargetQuery
  | SubrangeTargetQuery;

export type DirectControlTarget =
  | { kind: "CURRENT_PAGE" }
  | { kind: "LAST_OPERATION" };

export type DirectCommandTarget = TargetQuery | DirectControlTarget;

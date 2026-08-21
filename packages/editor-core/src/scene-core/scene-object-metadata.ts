import type { Rect } from "@ggulnote/shared-types";
import type { SceneObject, SceneObjectKind } from "./types";

export type UnifiedSceneObjectSource =
  | "PDF_BASE"
  | "USER_CANVAS"
  | "USER_ANNOTATION";

export interface SceneObjectCapabilities {
  readonly anchorable: boolean;
  readonly annotatable: boolean;
  readonly editable: boolean;
  readonly movable: boolean;
  readonly resizable: boolean;
  readonly deletable: boolean;
  readonly textRangeAddressable: boolean;
  readonly partAddressable: boolean;
}

export interface SceneObjectPartMetadata {
  readonly partId: string;
  readonly kind: string;
  readonly searchableText?: string;
  readonly bounds?: Rect;
  readonly attributes?: Readonly<Record<string, string | number>>;
}

export interface SceneObjectMetadataView {
  readonly objectId: string;
  readonly documentId?: string;
  readonly pageId: string;
  readonly kind: SceneObjectKind;
  readonly source: UnifiedSceneObjectSource;
  readonly bounds: Rect;
  readonly renderBounds: Rect;
  readonly rects?: readonly Rect[];
  readonly searchableText?: string;
  readonly normalizedText?: string;
  readonly canonicalMath?: string;
  readonly semanticAttributes?: Readonly<Record<string, unknown>>;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly createdByTurnId?: string;
  readonly creationOrder?: number;
  readonly readingOrder?: number;
  readonly parentId?: string;
  readonly parts?: readonly SceneObjectPartMetadata[];
  readonly capabilities: SceneObjectCapabilities;
}

export interface SceneObjectMetadataOptions {
  readonly documentId?: string;
}

export function describeSceneObject(
  object: SceneObject,
  options: SceneObjectMetadataOptions = {},
): SceneObjectMetadataView {
  const searchableText = sceneObjectSearchableText(object);
  const parts = sceneObjectParts(object);
  return Object.freeze({
    objectId: object.id,
    ...(options.documentId === undefined
      ? {}
      : { documentId: options.documentId }),
    pageId: object.pageId,
    kind: object.kind,
    source: sceneObjectUnifiedSource(object),
    bounds: freezeRect(object.bounds),
    renderBounds: freezeRect(object.renderBounds ?? object.bounds),
    ...(object.kind !== "annotation" || object.rects === undefined
      ? {}
      : { rects: Object.freeze(object.rects.map(freezeRect)) }),
    ...(searchableText === undefined ? {} : { searchableText }),
    ...(searchableText === undefined
      ? {}
      : { normalizedText: normalizeSceneObjectText(searchableText) }),
    ...(object.kind !== "math" ? {} : { canonicalMath: object.latex }),
    ...semanticMetadata(object),
    ...(object.createdAt === undefined ? {} : { createdAt: object.createdAt }),
    ...(object.updatedAt === undefined ? {} : { updatedAt: object.updatedAt }),
    ...(object.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: object.createdByTurnId }),
    ...creationOrdering(object),
    ...(object.parentId === undefined ? {} : { parentId: object.parentId }),
    ...(parts === undefined ? {} : { parts }),
    capabilities: sceneObjectCapabilities(object),
  });
}

export function sceneObjectUnifiedSource(
  object: SceneObject,
): UnifiedSceneObjectSource {
  if (object.source === "pdf") return "PDF_BASE";
  return object.kind === "annotation" ? "USER_ANNOTATION" : "USER_CANVAS";
}

export function sceneObjectCapabilities(
  object: SceneObject,
): SceneObjectCapabilities {
  if (object.source === "pdf") {
    const textAddressable = isTextKind(object.kind);
    return Object.freeze({
      anchorable: true,
      annotatable: true,
      editable: false,
      movable: false,
      resizable: false,
      deletable: false,
      textRangeAddressable: textAddressable,
      partAddressable: textAddressable || object.kind === "table",
    });
  }

  const mutable = !object.locked;
  const multiRect = object.kind === "annotation"
    && (object.rects?.length ?? 0) > 1;
  const lineShape = object.kind === "shape"
    && (object.shapeType === "line" || object.shapeType === "arrow");
  return Object.freeze({
    anchorable: true,
    annotatable: object.kind === "text",
    editable: mutable,
    movable: mutable,
    resizable: mutable && !multiRect && !lineShape,
    deletable: mutable,
    textRangeAddressable: object.kind === "text",
    partAddressable: object.kind === "graph"
      || object.kind === "table"
      || object.kind === "math"
      || object.kind === "group",
  });
}

export function normalizeSceneObjectText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function sceneObjectSearchableText(object: SceneObject): string | undefined {
  switch (object.kind) {
    case "paragraph":
    case "line":
    case "word":
    case "text":
      return nonEmpty(object.text);
    case "math":
      return nonEmpty(object.latex);
    case "graph":
      return nonEmpty(object.expressions.map((entry) => entry.expression).join(" "));
    case "table":
      return nonEmpty(object.cells.flatMap((cell) => cell.text ?? []).join(" "));
    case "shape":
      return object.shapeType;
    case "annotation":
      return nonEmpty([
        object.annotationType,
        object.style.color,
      ].filter((value): value is string => typeof value === "string").join(" "));
    case "image":
      return nonEmpty(object.imageSource ?? object.sourceAssetId ?? object.imageId);
    case "pdf-region":
      return nonEmpty(object.regionType);
    case "group":
      return undefined;
  }
}

function semanticMetadata(
  object: SceneObject,
): Pick<SceneObjectMetadataView, "semanticAttributes"> {
  let attributes: Record<string, unknown> | undefined;
  switch (object.kind) {
    case "annotation":
      attributes = {
        annotationType: object.annotationType,
        targetObjectIds: [...object.targetObjectIds],
      };
      break;
    case "graph":
      attributes = { expressionCount: object.expressions.length };
      break;
    case "table":
      attributes = { rows: object.rows, columns: object.columns };
      break;
    case "shape":
      attributes = { shapeType: object.shapeType };
      break;
    case "pdf-region":
      attributes = { regionType: object.regionType };
      break;
    default:
      break;
  }
  return attributes === undefined
    ? {}
    : { semanticAttributes: Object.freeze(attributes) };
}

function sceneObjectParts(
  object: SceneObject,
): readonly SceneObjectPartMetadata[] | undefined {
  if (object.kind === "graph") {
    return Object.freeze(object.expressions.map((entry, index) => Object.freeze({
      partId: entry.id,
      kind: "curve",
      searchableText: entry.expression,
      attributes: Object.freeze({ index: index + 1 }),
    })));
  }
  if (object.kind === "table") {
    const rows = Array.from({ length: object.rows }, (_, index) => Object.freeze({
      partId: `row:${index + 1}`,
      kind: "row",
      attributes: Object.freeze({ index: index + 1 }),
    }));
    const columns = Array.from({ length: object.columns }, (_, index) => Object.freeze({
      partId: `column:${index + 1}`,
      kind: "column",
      attributes: Object.freeze({ index: index + 1 }),
    }));
    const cells = object.cells.map((cell) => Object.freeze({
        partId: cell.id,
        kind: "cell",
        ...(cell.text === undefined ? {} : { searchableText: cell.text }),
        attributes: Object.freeze({
          row: cell.row,
          column: cell.column,
          ...(cell.rowSpan === undefined ? {} : { rowSpan: cell.rowSpan }),
          ...(cell.columnSpan === undefined ? {} : { columnSpan: cell.columnSpan }),
        }),
      }));
    return Object.freeze([...rows, ...columns, ...cells]);
  }
  if (object.kind === "math") {
    return Object.freeze([Object.freeze({
      partId: "expression:root",
      kind: "expression",
      searchableText: object.latex,
    })]);
  }
  if (object.kind === "group") {
    return Object.freeze(object.childIds.map((partId) => Object.freeze({
      partId,
      kind: "child",
    })));
  }
  return undefined;
}

function creationOrdering(
  object: SceneObject,
): Pick<SceneObjectMetadataView, "creationOrder" | "readingOrder"> {
  const readingOrder = "readingOrder" in object
    && typeof object.readingOrder === "number"
    && Number.isFinite(object.readingOrder)
    ? object.readingOrder
    : undefined;
  const creationOrder = object.creationOrder
    ?? (object.source === "canvas" ? object.createdAt : undefined);
  return {
    ...(creationOrder === undefined ? {} : { creationOrder }),
    ...(readingOrder === undefined ? {} : { readingOrder }),
  };
}

function isTextKind(kind: SceneObjectKind): boolean {
  return kind === "paragraph" || kind === "line" || kind === "word";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

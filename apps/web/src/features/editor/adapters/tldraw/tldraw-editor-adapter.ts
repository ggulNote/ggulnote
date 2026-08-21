import type {
  PageSceneSnapshot,
  Rect,
  SerializedAnnotation,
  Size,
} from "@ggulnote/editor-core";
import {
  MATH_TLDRAW_SHAPE_TYPE,
  parseMathObject,
  serializeMathObject,
  type MathObjectKind,
  type MathRenderOperation,
  type SerializedMathObject,
} from "@ggulnote/math-core";
import {
  Box,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  renderPlaintextFromRichText,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
} from "tldraw";
import {
  NOTE_ANNOTATION_SHAPE_TYPE,
  type NoteAnnotationSegment,
  type NoteAnnotationShape,
} from "./note-annotation-shape";
import {
  TldrawMathRenderAdapter,
  type TldrawMathRenderResult,
} from "./tldraw-math-render-adapter";
import type { MathObjectShape } from "./math-object-shape";
import { mathWriteOnKey } from "./math-object-shape";
import {
  HANDWRITING_TEXT_FONT_SIZE,
  HANDWRITING_TEXT_SHAPE_TYPE,
  textAnimationKey,
  type HandwritingTextShape,
} from "./handwriting-text-shape";
import {
  finishWriteOn,
  startWriteOn,
} from "./write-on-presentation";

const CANVAS_STORE_VERSION = 1;

interface GgulnoteShapeMeta {
  readonly canvasStoreVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdByTurnId?: string;
  readonly targetObjectIds?: readonly string[];
}

export type PreparedTldrawOperation =
  | {
      readonly kind: "CREATE_TEXT";
      readonly text: string;
      readonly bounds: Rect;
    }
  | {
      readonly kind: "REPLACE_TEXT";
      readonly objectId: string;
      readonly text: string;
    }
  | {
      readonly kind: "CREATE_ANNOTATION";
      readonly annotationType: "underline" | "highlight";
      readonly rects: readonly Rect[];
      readonly color?: string;
      readonly targetObjectIds?: readonly string[];
    }
  | {
      readonly kind: "APPLY_MATH_RENDER_OPERATION";
      readonly operation: MathRenderOperation;
    };

export interface TldrawObjectProjection {
  readonly objectId: string;
  readonly kind: "text" | "annotation" | "math";
  readonly bounds: Rect;
  readonly normalizedBounds: Rect;
  readonly text?: string;
  readonly annotationType?: "underline" | "highlight";
  readonly rects?: readonly Rect[];
  readonly selected: boolean;
  readonly focused: boolean;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly createdByTurnId?: string;
  readonly targetObjectIds?: readonly string[];
  readonly logicalObjectId?: string;
  readonly mathObjectKind?: MathObjectKind;
  readonly mathObjectSnapshot?: SerializedMathObject;
}

export interface TldrawOperationResult {
  readonly created?: string;
  readonly updated?: string;
}

export interface TldrawCommitResult {
  readonly createdObjectIds: readonly string[];
  readonly updatedObjectIds: readonly string[];
  readonly operationResults: readonly TldrawOperationResult[];
  readonly sceneRevision: number;
}

export interface TldrawPageImage {
  readonly imageDataUrl: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * Canvas infrastructure boundary. Agent/application code sees prepared operations
 * and projections, never Editor, TLShape, TLStore, or persistent shape ids.
 */
export class TldrawEditorAdapter {
  private sceneRevision = 0;
  private lastProjectionMs = 0;
  private readonly mathRenderAdapter: TldrawMathRenderAdapter;

  public constructor(
    private readonly editor: Editor,
    private readonly documentId: string,
    private readonly pageId: string,
    private readonly pageNumber: number,
    private pageSize: Size,
    private readonly now: () => number = Date.now,
  ) {
    this.mathRenderAdapter = new TldrawMathRenderAdapter(editor);
  }

  public setPageSize(pageSize: Size): void {
    assertPageSize(pageSize);
    this.pageSize = { ...pageSize };
  }

  public getSceneRevision(): number {
    return this.sceneRevision;
  }

  public getLastProjectionMs(): number {
    return this.lastProjectionMs;
  }

  /** Read-only full-page raster used only as visual Decision evidence. */
  public async capturePageImage(maxEdge = 1_280): Promise<TldrawPageImage | undefined> {
    if (!Number.isFinite(maxEdge) || maxEdge <= 0) {
      throw new RangeError("maxEdge must be finite and positive.");
    }
    const shapes = this.editor.getCurrentPageShapes();
    if (shapes.length === 0) return undefined;
    const scale = Math.min(1, maxEdge / Math.max(this.pageSize.width, this.pageSize.height));
    const image = await this.editor.toImageDataUrl(shapes, {
      background: false,
      bounds: new Box(0, 0, this.pageSize.width, this.pageSize.height),
      darkMode: false,
      format: "png",
      padding: 0,
      pixelRatio: 1,
      scale,
    });
    return Object.freeze({
      imageDataUrl: image.url,
      pixelWidth: image.width,
      pixelHeight: image.height,
    });
  }

  /** Advances the stale-scene token for direct canvas edits and selection changes. */
  public markSceneChanged(): number {
    this.sceneRevision += 1;
    return this.sceneRevision;
  }

  public getCurrentPageObjects(): readonly TldrawObjectProjection[] {
    const startedAt = monotonicNow();
    const selection = this.editor.getSelectedShapeIds();
    const focusedId = this.editor.getEditingShapeId();
    const objects = Object.freeze(this.editor.getCurrentPageShapesSorted().flatMap((shape) => {
      const projected = this.projectShape(shape, selection.includes(shape.id), focusedId === shape.id);
      return projected === undefined ? [] : [projected];
    }));
    this.lastProjectionMs = Math.max(0, monotonicNow() - startedAt);
    return objects;
  }

  public getObject(objectId: string): TldrawObjectProjection | undefined {
    const shape = this.editor.getShape(objectId as TLShapeId);
    if (shape === undefined) return undefined;
    const selection = this.editor.getSelectedShapeIds();
    return this.projectShape(
      shape,
      selection.includes(shape.id),
      this.editor.getEditingShapeId() === shape.id,
    );
  }

  public applyPreparedOperations(input: {
    readonly turnId: string;
    readonly operations: readonly PreparedTldrawOperation[];
  }): TldrawCommitResult {
    if (input.operations.length === 0) {
      throw new Error("A tldraw transaction requires at least one operation.");
    }
    const markId = this.editor.markHistoryStoppingPoint(`note-agent:${input.turnId}`);
    const createdObjectIds: string[] = [];
    const updatedObjectIds: string[] = [];
    const operationResults: TldrawOperationResult[] = [];
    try {
      this.editor.run(() => {
        for (const operation of input.operations) {
          const changed = this.applyOperation(operation, input.turnId);
          operationResults.push(changed);
          if (changed.created !== undefined) createdObjectIds.push(changed.created);
          if (changed.updated !== undefined) updatedObjectIds.push(changed.updated);
        }
      });
      this.editor.squashToMark(markId);
      this.sceneRevision += 1;
      return Object.freeze({
        createdObjectIds: Object.freeze(createdObjectIds),
        updatedObjectIds: Object.freeze(updatedObjectIds),
        operationResults: Object.freeze(operationResults),
        sceneRevision: this.sceneRevision,
      });
    } catch (error) {
      this.editor.bailToMark(markId);
      throw error;
    }
  }

  /** Independent math runtime hook; Note Agent registration remains a later concern. */
  public applyMathRenderOperation(operation: MathRenderOperation): TldrawMathRenderResult {
    const result = this.mathRenderAdapter.apply(operation);
    if (result.change !== "unchanged") this.sceneRevision += 1;
    return result;
  }

  public undo(): boolean {
    if (!this.editor.canUndo()) return false;
    this.editor.undo();
    this.sceneRevision += 1;
    return true;
  }

  public snapshot(): unknown {
    return {
      canvasStoreVersion: CANVAS_STORE_VERSION,
      snapshot: getSnapshot(this.editor.store),
    };
  }

  public load(value: unknown): void {
    const record = strictRecord(value);
    if (record.canvasStoreVersion !== CANVAS_STORE_VERSION) {
      throw new Error("Unsupported tldraw canvas snapshot version.");
    }
    loadSnapshot(this.editor.store, record.snapshot as Parameters<typeof loadSnapshot>[1]);
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (shape.type === HANDWRITING_TEXT_SHAPE_TYPE) {
        finishWriteOn(textAnimationKey(shape.id));
      } else if (shape.type === MATH_TLDRAW_SHAPE_TYPE) {
        finishWriteOn(mathWriteOnKey((shape as MathObjectShape).props.logicalObjectId));
      }
    }
    this.sceneRevision += 1;
  }

  public importLegacyPageSnapshot(snapshot: PageSceneSnapshot): void {
    if (this.editor.getCurrentPageShapes().length > 0) return;
    const operations = snapshot.annotations.flatMap((annotation) =>
      legacyAnnotationOperation(annotation, this.pageSize));
    if (operations.length === 0) return;
    this.applyPreparedOperations({ turnId: "legacy-import", operations });
    this.editor.clearHistory();
  }

  public exportPageProjection(): PageSceneSnapshot {
    const annotations = this.getCurrentPageObjects().flatMap((object, index) => {
      const annotation = projectionToSerializedAnnotation(object, this.pageId, this.pageSize, index);
      return annotation === undefined ? [] : [annotation];
    });
    return {
      documentId: this.documentId,
      pageId: this.pageId,
      pageNumber: this.pageNumber,
      revision: this.sceneRevision,
      annotations,
    };
  }

  private applyOperation(
    operation: PreparedTldrawOperation,
    turnId: string,
  ): { readonly created?: string; readonly updated?: string } {
    const timestamp = this.now();
    if (operation.kind === "APPLY_MATH_RENDER_OPERATION") {
      const result = this.mathRenderAdapter.apply(operation.operation);
      if (result.change === "unchanged" || result.change === "deleted") return {};
      const shape = this.editor.getShape<MathObjectShape>(result.shapeId);
      if (shape === undefined || shape.type !== MATH_TLDRAW_SHAPE_TYPE) {
        throw new Error("Rendered math shape is unavailable.");
      }
      const existingMeta = readMeta(shape);
      this.editor.updateShape<MathObjectShape>({
        id: shape.id,
        type: MATH_TLDRAW_SHAPE_TYPE,
        meta: shapeMeta({
          timestamp,
          turnId: result.change === "created"
            ? turnId
            : existingMeta.createdByTurnId ?? turnId,
          createdAt: result.change === "created"
            ? timestamp
            : existingMeta.createdAt || timestamp,
        }),
      });
      return result.change === "created"
        ? { created: result.shapeId }
        : { updated: result.shapeId };
    }
    if (operation.kind === "CREATE_TEXT") {
      const id = createShapeId();
      const animationKey = textAnimationKey(id);
      if (turnId !== "legacy-import") startWriteOn(animationKey, operation.text);
      try {
        this.editor.createShape<HandwritingTextShape>({
          id,
          type: HANDWRITING_TEXT_SHAPE_TYPE,
          x: operation.bounds.x,
          y: operation.bounds.y,
          props: {
            w: Math.max(1, operation.bounds.width),
            h: Math.max(1, operation.bounds.height),
            text: operation.text,
            fontSize: HANDWRITING_TEXT_FONT_SIZE,
          },
          meta: shapeMeta({ timestamp, turnId }),
        });
      } catch (error) {
        finishWriteOn(animationKey);
        throw error;
      }
      return { created: id };
    }
    if (operation.kind === "REPLACE_TEXT") {
      const id = operation.objectId as TLShapeId;
      const shape = this.editor.getShape(id);
      if (shape === undefined) {
        throw new Error("Tldraw text target does not exist.");
      }
      if (shape.type === HANDWRITING_TEXT_SHAPE_TYPE) {
        const handwriting = shape as HandwritingTextShape;
        finishWriteOn(textAnimationKey(id));
        this.editor.updateShape<HandwritingTextShape>({
          id,
          type: HANDWRITING_TEXT_SHAPE_TYPE,
          props: { text: operation.text },
          meta: shapeMeta({
            timestamp,
            turnId: readMeta(handwriting).createdByTurnId,
            createdAt: readMeta(handwriting).createdAt,
          }),
        });
        return { updated: id };
      }
      if (shape.type !== "text") {
        throw new Error("Tldraw text target does not exist.");
      }
      const textShape = shape as TLTextShape;
      this.editor.updateShape<TLTextShape>({
        id,
        type: "text",
        props: { richText: toRichText(operation.text), autoSize: true },
        meta: shapeMeta({
          timestamp,
          turnId: readMeta(textShape).createdByTurnId,
          createdAt: readMeta(textShape).createdAt,
        }),
      });
      return { updated: id };
    }
    const union = unionRects(operation.rects);
    if (union === undefined) throw new Error("Annotation geometry is empty.");
    const id = createShapeId();
    const segments = operation.rects.map((rect): NoteAnnotationSegment => ({
      x: rect.x - union.x,
      y: rect.y - union.y,
      width: rect.width,
      height: rect.height,
    }));
    this.editor.createShape<NoteAnnotationShape>({
      id,
      type: NOTE_ANNOTATION_SHAPE_TYPE,
      x: union.x,
      y: union.y,
      props: {
        w: union.width,
        h: union.height,
        annotationType: operation.annotationType,
        segments,
        color: operation.color
          ?? (operation.annotationType === "highlight" ? "#facc15" : "#1f2937"),
        opacity: operation.annotationType === "highlight" ? 0.35 : 1,
        thickness: 2,
      },
      meta: shapeMeta({
        timestamp,
        turnId,
        targetObjectIds: operation.targetObjectIds,
      }),
    });
    return { created: id };
  }

  private projectShape(
    shape: TLShape,
    selected: boolean,
    focused: boolean,
  ): TldrawObjectProjection | undefined {
    const box = this.editor.getShapePageBounds(shape);
    if (box === undefined) return undefined;
    const bounds = { x: box.x, y: box.y, width: box.w, height: box.h };
    const normalizedBounds = normalizeRect(bounds, this.pageSize);
    const meta = readMeta(shape);
    if (shape.type === "text") {
      const textShape = shape as TLTextShape;
      return Object.freeze({
        objectId: shape.id,
        kind: "text",
        bounds: Object.freeze(bounds),
        normalizedBounds: Object.freeze(normalizedBounds),
        text: renderPlaintextFromRichText(this.editor, textShape.props.richText),
        selected,
        focused,
        ...projectedMeta(meta),
      });
    }
    if (shape.type === HANDWRITING_TEXT_SHAPE_TYPE) {
      const textShape = shape as HandwritingTextShape;
      return Object.freeze({
        objectId: shape.id,
        kind: "text",
        bounds: Object.freeze(bounds),
        normalizedBounds: Object.freeze(normalizedBounds),
        text: textShape.props.text,
        selected,
        focused,
        ...projectedMeta(meta),
      });
    }
    if (shape.type === MATH_TLDRAW_SHAPE_TYPE) {
      const mathShape = shape as MathObjectShape;
      try {
        const object = parseMathObject(mathShape.props.serializedObject);
        return Object.freeze({
          objectId: shape.id,
          kind: "math",
          bounds: Object.freeze(bounds),
          normalizedBounds: Object.freeze(normalizedBounds),
          logicalObjectId: object.id,
          mathObjectKind: object.kind,
          mathObjectSnapshot: serializeMathObject(object),
          selected,
          focused,
          ...projectedMeta(meta),
        });
      } catch {
        return undefined;
      }
    }
    if (shape.type !== NOTE_ANNOTATION_SHAPE_TYPE) return undefined;
    const annotation = shape as NoteAnnotationShape;
    const rects = annotation.props.segments.map((segment) => ({
      x: shape.x + segment.x,
      y: shape.y + segment.y,
      width: segment.width,
      height: segment.height,
    }));
    return Object.freeze({
      objectId: shape.id,
      kind: "annotation",
      bounds: Object.freeze(bounds),
      normalizedBounds: Object.freeze(normalizedBounds),
      annotationType: annotation.props.annotationType,
      rects: Object.freeze(rects),
      selected,
      focused,
      ...projectedMeta(meta),
    });
  }
}

function projectionToSerializedAnnotation(
  object: TldrawObjectProjection,
  pageId: string,
  pageSize: Size,
  zIndex: number,
): SerializedAnnotation | undefined {
  if (object.kind === "math") return undefined;
  const createdAt = object.createdAt ?? 0;
  const updatedAt = object.updatedAt ?? createdAt;
  if (object.kind === "text") {
    return {
      schemaVersion: 1,
      id: object.objectId,
      pageId,
      type: "TEXT",
      bounds: { ...object.normalizedBounds },
      zIndex,
      properties: {
        text: object.text ?? "",
        fontSize: 18,
        textFontFamily: "Arial",
        textFontWeight: "normal",
      },
      createdAt,
      updatedAt,
      ...(object.createdByTurnId === undefined
        ? {}
        : { createdByTurnId: object.createdByTurnId }),
      creationOrder: zIndex + 1,
    };
  }
  return {
    schemaVersion: 1,
    id: object.objectId,
    pageId,
    type: object.annotationType === "highlight" ? "HIGHLIGHT" : "UNDERLINE",
    bounds: { ...object.normalizedBounds },
    rects: object.rects?.map((rect) => normalizeRect(rect, pageSize)),
    targetObjectIds: object.targetObjectIds === undefined
      ? undefined
      : [...object.targetObjectIds],
    zIndex,
    properties: object.annotationType === "highlight"
      ? { color: "#facc15", opacity: 0.35 }
      : { color: "#1f2937", thickness: 2 },
    createdAt,
    updatedAt,
    ...(object.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: object.createdByTurnId }),
    creationOrder: zIndex + 1,
  };
}

function legacyAnnotationOperation(
  annotation: SerializedAnnotation,
  pageSize: Size,
): readonly PreparedTldrawOperation[] {
  const bounds = denormalizeRect(annotation.bounds, pageSize);
  if (annotation.type === "TEXT") {
    const text = typeof annotation.properties.text === "string"
      ? annotation.properties.text
      : "";
    return text.length === 0 ? [] : [{ kind: "CREATE_TEXT", text, bounds }];
  }
  if (annotation.type !== "UNDERLINE" && annotation.type !== "HIGHLIGHT") return [];
  const rects = annotation.rects?.map((rect) => denormalizeRect(rect, pageSize)) ?? [bounds];
  return [{
    kind: "CREATE_ANNOTATION",
    annotationType: annotation.type === "HIGHLIGHT" ? "highlight" : "underline",
    rects,
    ...(typeof annotation.properties.color === "string"
      ? { color: annotation.properties.color }
      : {}),
    ...(annotation.targetObjectIds === undefined
      ? {}
      : { targetObjectIds: annotation.targetObjectIds }),
  }];
}

function shapeMeta(input: {
  readonly timestamp: number;
  readonly turnId?: string;
  readonly createdAt?: number;
  readonly targetObjectIds?: readonly string[];
}) {
  return {
    ggulnote: {
      canvasStoreVersion: CANVAS_STORE_VERSION,
      createdAt: input.createdAt ?? input.timestamp,
      updatedAt: input.timestamp,
      ...(input.turnId === undefined ? {} : { createdByTurnId: input.turnId }),
      ...(input.targetObjectIds === undefined
        ? {}
        : { targetObjectIds: [...input.targetObjectIds] }),
    },
  };
}

function readMeta(shape: TLShape): GgulnoteShapeMeta {
  const meta = strictRecord(shape.meta);
  const value = strictRecord(meta.ggulnote);
  return {
    canvasStoreVersion: readNumber(value.canvasStoreVersion) ?? CANVAS_STORE_VERSION,
    createdAt: readNumber(value.createdAt) ?? 0,
    updatedAt: readNumber(value.updatedAt) ?? 0,
    ...(typeof value.createdByTurnId === "string"
      ? { createdByTurnId: value.createdByTurnId }
      : {}),
    ...(Array.isArray(value.targetObjectIds)
      ? { targetObjectIds: value.targetObjectIds.filter((id): id is string => typeof id === "string") }
      : {}),
  };
}

function projectedMeta(meta: GgulnoteShapeMeta) {
  return {
    ...(meta.createdAt <= 0 ? {} : { createdAt: meta.createdAt }),
    ...(meta.updatedAt <= 0 ? {} : { updatedAt: meta.updatedAt }),
    ...(meta.createdByTurnId === undefined ? {} : { createdByTurnId: meta.createdByTurnId }),
    ...(meta.targetObjectIds === undefined ? {} : { targetObjectIds: meta.targetObjectIds }),
  };
}

function normalizeRect(rect: Rect, pageSize: Size): Rect {
  assertPageSize(pageSize);
  return {
    x: rect.x / pageSize.width,
    y: rect.y / pageSize.height,
    width: rect.width / pageSize.width,
    height: rect.height / pageSize.height,
  };
}

function denormalizeRect(rect: Rect, pageSize: Size): Rect {
  assertPageSize(pageSize);
  return {
    x: rect.x * pageSize.width,
    y: rect.y * pageSize.height,
    width: rect.width * pageSize.width,
    height: rect.height * pageSize.height,
  };
}

function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function assertPageSize(size: Size): void {
  if (!Number.isFinite(size.width) || size.width <= 0
    || !Number.isFinite(size.height) || size.height <= 0) {
    throw new RangeError("Tldraw page size must be finite and positive.");
  }
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function strictRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

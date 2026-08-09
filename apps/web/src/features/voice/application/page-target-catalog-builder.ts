import type {
  EditorHistoryAction,
  EditorOperation,
  SceneObject,
  SceneSnapshot,
} from "@ggulnote/editor-core";
import { normalizedToCanonicalRect } from "@ggulnote/editor-core";
import type { PageSemanticModel, SemanticSentence } from "@ggulnote/document-core";
import type {
  DirectRecentOperation,
  PageTargetCandidate,
  PageTargetCatalog,
} from "../domain";

export interface PageTargetCatalogBuilderInput {
  scene: SceneSnapshot;
  semanticModel?: PageSemanticModel;
  recentOperations?: readonly DirectRecentOperation[];
}

export function buildPageTargetCatalog(
  input: PageTargetCatalogBuilderInput,
): PageTargetCatalog {
  const operations = input.recentOperations ?? [];
  const sceneCandidates = input.scene.objects
    .filter((object) =>
      object.pageId === input.scene.page.id && object.visible)
    .map((object) => sceneObjectToCandidate(object, operations));
  const sentenceCandidates = input.semanticModel === undefined
    ? []
    : input.semanticModel
      .getAllByReadingOrder()
      .filter((object): object is SemanticSentence =>
        object.type === "SENTENCE" && object.pageId === input.scene.page.id)
      .map((sentence) => semanticSentenceToCandidate(sentence, input.scene));

  return {
    pageId: input.scene.page.id,
    sceneRevision: input.scene.sceneRevision,
    candidates: [...sceneCandidates, ...sentenceCandidates],
  };
}

export function summarizeEditorOperation(
  operation: EditorOperation,
  scene: SceneSnapshot,
  historyAction?: EditorHistoryAction,
): DirectRecentOperation {
  const targetSceneObjectId = findOperationTargetSceneObjectId(operation, scene);
  return {
    operationId: operation.operationId,
    pageId: operation.pageId,
    operationType: operation.type,
    annotationId: operation.annotationId,
    createdAt: operation.createdAt,
    ...(historyAction === undefined ? {} : { historyAction }),
    ...(targetSceneObjectId === undefined ? {} : { targetSceneObjectId }),
  };
}

function sceneObjectToCandidate(
  object: SceneObject,
  operations: readonly DirectRecentOperation[],
): PageTargetCandidate {
  const operation = latestOperationForObject(object.id, operations);
  const text = sceneObjectSearchText(object);
  const semanticUnit = object.kind === "paragraph"
    ? "paragraph" as const
    : object.kind === "line"
      ? "line" as const
      : undefined;
  const readingOrder = "readingOrder" in object
    && typeof object.readingOrder === "number"
    ? object.readingOrder
    : undefined;
  const isPdfText = object.source === "pdf"
    && (object.kind === "paragraph" || object.kind === "line" || object.kind === "word");
  const isEditableText = object.source === "canvas"
    && object.kind === "text"
    && !object.locked;

  return {
    candidateId: `target:scene:${object.id}`,
    source: object.source === "pdf" ? "pdf" : "ggulnote",
    type: object.kind,
    pageId: object.pageId,
    sceneObjectId: object.id,
    objectRevision: object.objectRevision,
    ...(text === undefined || text.length === 0 ? {} : { text }),
    bounds: { ...object.bounds },
    editable: object.source === "canvas" && !object.locked,
    annotatable: isPdfText || isEditableText,
    ...(semanticUnit === undefined ? {} : { semanticUnit }),
    ...(readingOrder === undefined ? {} : { readingOrder }),
    ...(object.createdAt === undefined ? {} : { createdAt: object.createdAt }),
    ...(operation === undefined ? {} : { operationId: operation.operationId }),
  };
}

function semanticSentenceToCandidate(
  sentence: SemanticSentence,
  scene: SceneSnapshot,
): PageTargetCandidate {
  return {
    candidateId: `target:semantic:sentence:${sentence.id}`,
    source: "pdf",
    type: "sentence",
    pageId: sentence.pageId,
    semanticObjectId: sentence.id,
    text: sentence.text,
    bounds: normalizedToCanonicalRect(sentence.bounds, {
      width: scene.page.width,
      height: scene.page.height,
    }),
    editable: false,
    annotatable: true,
    semanticUnit: "sentence",
    readingOrder: sentence.readingOrder,
  };
}

function sceneObjectSearchText(object: SceneObject): string | undefined {
  switch (object.kind) {
    case "paragraph":
    case "line":
    case "word":
    case "text":
      return object.text;
    case "math":
      return object.latex;
    case "graph":
      return object.expressions.map((entry) => entry.expression).join(" ");
    case "table":
      return object.cells.flatMap((cell) => cell.text ?? []).join(" ");
    case "shape":
      return object.shapeType;
    case "annotation":
      return [
        object.annotationType,
        object.style.color,
      ].filter((value): value is string => typeof value === "string").join(" ");
    case "image":
      return object.imageSource ?? object.sourceAssetId ?? object.imageId;
    case "pdf-region":
      return object.regionType;
    case "group":
      return undefined;
  }
}

function latestOperationForObject(
  sceneObjectId: string,
  operations: readonly DirectRecentOperation[],
): DirectRecentOperation | undefined {
  return operations
    .filter((operation) => operation.targetSceneObjectId === sceneObjectId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function findOperationTargetSceneObjectId(
  operation: EditorOperation,
  scene: SceneSnapshot,
): string | undefined {
  const annotationId = sanitizeSceneIdSegment(operation.annotationId);
  return scene.objects.find((object) => {
    if (object.source !== "canvas" || object.pageId !== operation.pageId) {
      return false;
    }
    return object.id.split(":").at(-1) === annotationId;
  })?.id;
}

function sanitizeSceneIdSegment(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "item" : trimmed.replace(/[:\s]+/gu, "-");
}

import {
  NoteAgentValidationError,
  parseActionTarget,
  parseDestination,
  parseEntitySelector,
  type Destination,
  type EntitySelector,
  type DecisionDestination,
  type DecisionObjectPartRef,
  type DecisionObjectRef,
  type NoteToolId,
  type NoteToolResult,
} from "../domain";
import {
  buildCanonicalTextStream,
  resolveTextSpanWithCanonicalStream,
} from "../../application/canonical-text-stream";
import { capabilitiesForRef, type WorldResolutionResult } from "../world";
import {
  NoteToolRegistry,
  type NoteSchema,
  type NoteTool,
  type NoteToolContext,
  resolveEntitySelector,
} from "./note-tool-registry";
import { createMathTools } from "./math-tools";
import { createUnavailableExtensionTools } from "./extension-boundary-tools";

interface PreparedActionValue {
  readonly prepared: true;
}

interface TextCreateInput {
  readonly text: string;
  readonly target?: DecisionObjectRef;
  readonly destination?: Destination | DecisionDestination;
}

interface TargetedTextInput {
  readonly target: EntitySelector | DecisionObjectRef;
  readonly text: string;
}

interface AnnotationApplyInput {
  readonly target: EntitySelector | DecisionObjectRef;
  readonly annotationType: "UNDERLINE" | "HIGHLIGHT";
  readonly color?: string;
}

export function createExistingNoteToolRegistry(): NoteToolRegistry {
  const registry = new NoteToolRegistry();
  registry.register(textCreateTool());
  registry.register(textReplaceTool());
  registry.register(annotationApplyTool());
  registry.register(controlTool("navigation.next_page", "navigation", "next_page"));
  registry.register(controlTool("navigation.previous_page", "navigation", "previous_page"));
  registry.register(controlTool("history.undo", "history", "undo"));
  for (const tool of createMathTools()) registry.register(tool);
  for (const tool of createUnavailableExtensionTools()) registry.register(tool);
  return registry;
}

function textCreateTool(): NoteTool<TextCreateInput, PreparedActionValue> {
  return {
    id: "text.create",
    kind: "MUTATION",
    description: "Create ordinary written language or a label. Do not use this when the content's primary meaning is a mathematical expression, equation, or formula. Omit destination when location is unspecified.",
    examples: ["가나다라 써 줘", "안녕하세요 아래에 가나다라 써 줘"],
    inputSchema: textCreateSchema,
    outputSchema: preparedActionValueSchema,
    decisionArgsSchema: strictObjectSchema({
      text: { type: "string", minLength: 1 },
    }, ["text"]),
    isAvailable: (context) =>
      context.placement !== undefined
      && context.preparePlacement !== undefined
      && (context.mode === "SHADOW" || context.productionPlacementAvailable === true),
    prepare: async (input, context) => {
      if (context.placement === undefined || context.preparePlacement === undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "PLACEMENT_UNAVAILABLE" };
      }
      const prepared = await context.preparePlacement("text.create", input);
      if (prepared === undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "MEASUREMENT_UNAVAILABLE" };
      }
      let anchorRef;
      const resolvedActionAnchor = input.target === undefined
        ? undefined
        : context.resolvedTarget?.anchor;
      if (isDecisionDestination(input.destination)) {
        if (input.destination.relation !== "CANVAS_REGION") {
          if (resolvedActionAnchor !== undefined) {
            anchorRef = context.resolvedTarget?.objectRef;
          } else if (input.destination.anchor === null) {
            return { status: "NEEDS_INPUT", missing: ["destination.anchor"] };
          } else {
            const directAnchor = resolveDecisionAnchorRef(input.destination.anchor, context);
            if ("result" in directAnchor) return directAnchor.result;
            if (directAnchor.status !== "RESOLVED") {
              return { status: "FAILED", reasonCode: "ANCHOR_RESOLUTION_FAILED" };
            }
            anchorRef = directAnchor.ref;
          }
        }
      } else if (input.destination?.kind === "RELATIVE") {
        const selector = "context" in input.destination.anchor
          ? { context: input.destination.anchor.context }
          : input.destination.anchor;
        const anchorStartedAt = context.metrics?.now();
        const resolved = await context.resolver.resolve(selector, context.frozenWorld);
        if (anchorStartedAt !== undefined) {
          context.metrics?.add("resolverMs", context.metrics.now() - anchorStartedAt);
        }
        const resolvedAnchor = resolved.status === "RESOLVED" ? resolved.ref : undefined;
        if (resolvedAnchor === undefined) {
          if (resolved.status === "AMBIGUOUS") {
            return { status: "AMBIGUOUS", candidates: resolved.candidates };
          }
          if (resolved.status === "NOT_FOUND") return { status: "NOT_FOUND" };
          return resolved.status === "UNSUPPORTED" && resolved.reasonCode === "STALE_SCENE"
            ? { status: "STALE_SCENE" }
            : { status: "FAILED", reasonCode: resolved.status === "UNSUPPORTED"
                ? resolved.reasonCode
                : "ANCHOR_RESOLUTION_FAILED" };
        }
        anchorRef = resolvedAnchor;
      }
      const runtimeDestination = isDecisionDestination(input.destination)
        ? placementDestination(input.destination, resolvedActionAnchor !== undefined)
        : input.destination;
      if (isDecisionDestination(input.destination) && runtimeDestination === undefined) {
        return { status: "NEEDS_INPUT", missing: ["destination"] };
      }
      const placementStartedAt = context.metrics?.now();
      const spatialDecisionInstruction = JSON.stringify({
        destination: input.destination ?? null,
      });
      const placement = await context.placement.resolve({
        ...(runtimeDestination === undefined ? {} : { destination: runtimeDestination }),
        ...prepared,
        worldContext: context.frozenWorld,
        ...(anchorRef === undefined ? {} : { anchorRef }),
        ...(resolvedActionAnchor === undefined
          ? {}
          : { resolvedAnchor: resolvedActionAnchor }),
      });
      if (placementStartedAt !== undefined) {
        context.metrics?.add("placementMs", context.metrics.now() - placementStartedAt);
      }
      if (placement.status === "AMBIGUOUS") {
        return { status: "AMBIGUOUS", candidates: placement.candidates };
      }
      if (placement.status === "NO_FEASIBLE_PLACEMENT") {
        return { status: "NO_FEASIBLE_PLACEMENT" };
      }
      if (placement.status === "STALE_SCENE") return { status: "STALE_SCENE" };
      if (placement.status === "FAILED") {
        return { status: "FAILED", reasonCode: placement.reasonCode };
      }
      return {
        status: "READY",
        value: { prepared: true },
        operations: [{
          kind: "EXISTING_EDITOR_OPERATION",
          data: {
            existingCommand: {
              capability: "text",
              operation: "create",
              payload: { text: input.text },
            },
            placement: placement.placement,
            ...(runtimeDestination === undefined ? {} : { destination: runtimeDestination }),
            ...(anchorRef === undefined ? {} : { target: anchorRef }),
            tldrawOperation: {
              kind: "CREATE_TEXT",
              text: input.text,
              bounds: placement.placement.bounds,
            },
            spatialDecisionInstruction,
          },
        }],
      };
    },
  };
}

function textReplaceTool(): NoteTool<TargetedTextInput, PreparedActionValue> {
  return {
    id: "text.replace",
    kind: "MUTATION",
    description: "Replace content of an editable user text object.",
    examples: ["이 텍스트를 새 내용으로 바꿔 줘"],
    inputSchema: targetedTextSchema,
    outputSchema: preparedActionValueSchema,
    decisionArgsSchema: strictObjectSchema({ text: { type: "string" } }, ["text"]),
    isAvailable: () => true,
    prepare: async (input, context) => {
      const resolved = isDecisionObjectRef(input.target)
        ? resolveDecisionObjectRef(input.target, context)
        : await resolveEntitySelector(input.target, context);
      if ("result" in resolved) return resolved.result;
      const failure = resolutionFailure(resolved);
      if (failure !== undefined) return failure;
      if (resolved.status !== "RESOLVED") {
        return { status: "FAILED", reasonCode: "UNEXPECTED_RESOLUTION" };
      }
      const capabilities = capabilitiesForRef(resolved.ref, context.world);
      if (capabilities?.editable !== true) {
        return { status: "NOT_ALLOWED", reasonCode: "TARGET_NOT_EDITABLE" };
      }
      const tldrawObjectId = tldrawObjectIdForRef(resolved.ref, context);
      if (isDecisionObjectRef(input.target) && tldrawObjectId === undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "TARGET_NOT_TLDRAW_TEXT" };
      }
      return {
        status: "READY",
        value: { prepared: true },
        operations: [{
          kind: "EXISTING_EDITOR_OPERATION",
          data: {
            existingCommand: {
              capability: "text",
              operation: "replace_content",
              payload: { text: input.text },
            },
            target: resolved.ref,
            ...(tldrawObjectId === undefined ? {} : {
              tldrawOperation: {
                kind: "REPLACE_TEXT",
                objectId: tldrawObjectId,
                text: input.text,
              },
            }),
          },
        }],
      };
    },
  };
}

function annotationApplyTool(): NoteTool<AnnotationApplyInput, PreparedActionValue> {
  return {
    id: "annotation.apply",
    kind: "MUTATION",
    description: "Apply underline/highlight. For a partial span, ground across all supplied object text first, select the object containing that span, and return exact canonical startText/endText; destination is null.",
    examples: ["Moreover부터 instance까지 밑줄 쳐 줘"],
    inputSchema: annotationApplySchema,
    outputSchema: preparedActionValueSchema,
    decisionArgsSchema: strictObjectSchema({
      annotationType: { type: "string", enum: ["UNDERLINE", "HIGHLIGHT"] },
      color: { type: ["string", "null"] },
    }, ["annotationType", "color"]),
    isAvailable: () => true,
    prepare: async (input, context) => {
      const resolved = isDecisionObjectRef(input.target)
        ? resolveDecisionObjectRef(input.target, context)
        : await resolveEntitySelector(input.target, context);
      if ("result" in resolved) return resolved.result;
      const failure = resolutionFailure(resolved);
      if (failure !== undefined) return failure;
      if (resolved.status !== "RESOLVED") {
        return { status: "FAILED", reasonCode: "UNEXPECTED_RESOLUTION" };
      }
      const capabilities = capabilitiesForRef(resolved.ref, context.world);
      const annotatableRange = resolved.ref.kind === "TEXT_RANGE"
        && resolved.ref.rects.length > 0;
      if (!annotatableRange && capabilities?.annotatable !== true) {
        return { status: "NOT_ALLOWED", reasonCode: "TARGET_NOT_ANNOTATABLE" };
      }
      const annotationRects = rectsForRef(resolved.ref, context);
      if (annotationRects.length === 0) return { status: "NOT_FOUND" };
      return {
        status: "READY",
        value: { prepared: true },
        operations: [{
          kind: "EXISTING_EDITOR_OPERATION",
          data: {
            existingCommand: {
              capability: "annotation",
              operation: input.annotationType === "UNDERLINE" ? "underline" : "highlight",
              payload: input.color === undefined ? {} : { color: input.color },
            },
            target: resolved.ref,
            tldrawOperation: {
              kind: "CREATE_ANNOTATION",
              annotationType: input.annotationType === "UNDERLINE" ? "underline" : "highlight",
              rects: annotationRects,
              ...(input.color === undefined ? {} : { color: input.color }),
              targetObjectIds: resolved.ref.kind === "TEXT_RANGE"
                ? resolved.ref.objectIds
                : resolved.ref.kind === "OBJECT" || resolved.ref.kind === "OBJECT_PART"
                  ? [resolved.ref.objectId]
                  : [],
            },
          },
        }],
      };
    },
  };
}

function controlTool(
  id: NoteToolId,
  capability: string,
  operation: string,
): NoteTool<Record<string, never>, PreparedActionValue> {
  return {
    id,
    kind: "MUTATION",
    description: operation === "next_page"
      ? "Move to the next page."
      : operation === "previous_page"
        ? "Move to the previous page."
        : "Undo the latest edit.",
    examples: operation === "next_page"
      ? ["다음 페이지"]
      : operation === "previous_page" ? ["이전 페이지"] : ["방금 거 취소해"],
    inputSchema: emptyObjectSchema,
    outputSchema: preparedActionValueSchema,
    decisionArgsSchema: strictObjectSchema({}, []),
    isAvailable: () => true,
    prepare: async () => ({
      status: "READY",
      value: { prepared: true },
      operations: [{
        kind: "EXISTING_EDITOR_OPERATION",
        data: { existingCommand: { capability, operation, payload: {} } },
      }],
    }),
  };
}

function resolutionFailure(
  result: WorldResolutionResult,
): Exclude<NoteToolResult<never>, { status: "SUCCESS" }> | undefined {
  if (result.status === "AMBIGUOUS") {
    return { status: "AMBIGUOUS", candidates: result.candidates };
  }
  if (result.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (result.status === "UNSUPPORTED") {
    return result.reasonCode === "STALE_SCENE"
      ? { status: "STALE_SCENE" }
      : { status: "FAILED", reasonCode: result.reasonCode };
  }
  return undefined;
}

function parseToolTarget(
  value: unknown,
  path: string,
): EntitySelector | DecisionObjectRef {
  const target = strictRecord(value, path, [
    "object", "part", "region", "fallbackPoint",
    "scope", "kinds", "source", "content", "attributes",
    "temporal", "ordinal", "context", "spatial",
  ]);
  if (!("object" in target)) return parseEntitySelector(value, path);
  return parseActionTarget(value, path);
}

function parseDecisionPart(value: unknown, path: string): DecisionObjectPartRef {
  const part = strictRecord(value, path, [
    "kind", "index", "row", "column", "text", "startText", "endText",
  ]);
  const kind = stringValue(part.kind, `${path}.kind`);
  if (![
    "curve", "point", "tangent", "row", "column", "cell", "expression",
    "subexpression", "text_range",
  ].includes(kind)) {
    throw new NoteAgentValidationError(`${path}.kind`, "unsupported object part kind");
  }
  return {
    kind: kind as DecisionObjectPartRef["kind"],
    index: nullablePositiveInteger(part.index, `${path}.index`),
    row: nullablePositiveInteger(part.row, `${path}.row`),
    column: nullablePositiveInteger(part.column, `${path}.column`),
    text: nullableString(part.text, `${path}.text`),
    startText: nullableString(part.startText, `${path}.startText`),
    endText: nullableString(part.endText, `${path}.endText`),
  };
}

function parseToolDestination(
  value: unknown,
  path: string,
): Destination | DecisionDestination {
  const destination = strictRecord(value, path, [
    "kind", "region", "alignment", "avoidOverlap", "relation", "anchor", "distance",
  ]);
  if (destination.kind !== undefined) return parseDestination(value, path);
  const relation = stringValue(destination.relation, `${path}.relation`);
  if (![
    "ABOVE", "BELOW", "LEFT_OF", "RIGHT_OF", "NEAR", "INSIDE", "BETWEEN", "CANVAS_REGION",
  ].includes(relation)) {
    throw new NoteAgentValidationError(`${path}.relation`, "unsupported destination relation");
  }
  const region = destination.region === null || destination.region === undefined
    ? null
    : stringValue(destination.region, `${path}.region`) as DecisionDestination["region"];
  return {
    relation: relation as DecisionDestination["relation"],
    anchor: destination.anchor === null || destination.anchor === undefined
      ? null
      : parseToolTarget(destination.anchor, `${path}.anchor`) as DecisionObjectRef,
    region,
  };
}

function isDecisionObjectRef(
  target: EntitySelector | DecisionObjectRef,
): target is DecisionObjectRef {
  return "object" in target;
}

function isDecisionDestination(
  destination: Destination | DecisionDestination | undefined,
): destination is DecisionDestination {
  return destination !== undefined && !("kind" in destination);
}

function resolveDecisionObjectRef(
  target: DecisionObjectRef,
  context: NoteToolContext,
): WorldResolutionResult | {
  readonly result: Exclude<NoteToolResult<never>, { status: "SUCCESS" }>;
} {
  if (target.object === null) {
    return { result: { status: "NOT_FOUND" } };
  }
  const runtimeTarget = context.resolvedTarget;
  if (
    runtimeTarget?.objectHandle === target.object
    && runtimeTarget.objectRef !== undefined
    && target.part === null
  ) {
    if (runtimeTarget.mode !== "OBJECT_REGION") {
      return { status: "RESOLVED", ref: runtimeTarget.objectRef };
    }
    const objectId = runtimeTarget.objectRef.kind === "OBJECT"
      || runtimeTarget.objectRef.kind === "OBJECT_PART"
      ? runtimeTarget.objectRef.objectId
      : undefined;
    if (objectId !== undefined) {
      return {
        status: "RESOLVED",
        ref: {
          kind: "OBJECT_PART",
          objectId,
          partId: `${objectId}:visual-region`,
          bounds: { ...runtimeTarget.canvasBounds },
        },
      };
    }
  }
  const ref = context.handles?.resolve(target.object);
  if (ref === undefined) {
    return { result: { status: "FAILED", reasonCode: "INVALID_HANDLE" } };
  }
  if (target.part === null) return { status: "RESOLVED", ref };
  if (target.part.kind === "text_range") {
    return resolvePdfTextRange(ref, target.part, context);
  }
  if (ref.kind !== "OBJECT") return { result: { status: "NOT_FOUND" } };
  const parts = context.world.getObjectMetadata(ref.objectId)?.parts ?? [];
  const candidates = parts.filter((part, index) =>
    part.kind === target.part?.kind
    && (target.part.index === null || target.part.index === undefined || target.part.index === index + 1)
    && (target.part.row === null || target.part.row === undefined || part.attributes?.row === target.part.row)
    && (target.part.column === null || target.part.column === undefined
      || part.attributes?.column === target.part.column));
  if (candidates.length !== 1) {
    return { result: candidates.length === 0
      ? { status: "NOT_FOUND" }
      : { status: "NEEDS_INPUT", missing: ["target.part"] } };
  }
  const part = candidates[0];
  if (part === undefined) return { result: { status: "NOT_FOUND" } };
  return {
    status: "RESOLVED",
    ref: {
      kind: "OBJECT_PART",
      objectId: ref.objectId,
      partId: part.partId,
      ...(part.bounds === undefined ? {} : { bounds: { ...part.bounds } }),
    },
  };
}

function resolveDecisionAnchorRef(
  target: DecisionObjectRef,
  context: NoteToolContext,
): WorldResolutionResult | {
  readonly result: Exclude<NoteToolResult<never>, { status: "SUCCESS" }>;
} {
  if (target.object === null) {
    return { result: { status: "NOT_FOUND" } };
  }
  if (target.part?.kind !== "text_range") {
    return resolveDecisionObjectRef(target, context);
  }
  const ref = context.handles?.resolve(target.object);
  if (ref === undefined) {
    return { result: { status: "FAILED", reasonCode: "INVALID_HANDLE" } };
  }
  if (ref.kind !== "OBJECT") return { result: { status: "NOT_FOUND" } };
  const object = context.world.getObject(ref.objectId);
  const metadata = context.world.getObjectMetadata(ref.objectId);
  if (
    object?.source === "canvas"
    && object.kind === "text"
    && metadata?.capabilities.textRangeAddressable === true
  ) {
    return { status: "RESOLVED", ref };
  }
  return resolveDecisionObjectRef(target, context);
}

function resolvePdfTextRange(
  ref: import("../world").EntityRef,
  part: DecisionObjectPartRef,
  context: NoteToolContext,
): WorldResolutionResult | {
  readonly result: Exclude<NoteToolResult<never>, { status: "SUCCESS" }>;
} {
  if (ref.kind !== "OBJECT") return { result: { status: "NOT_FOUND" } };
  const selected = context.world.getObject(ref.objectId);
  const semanticModel = context.frozenWorld.catalog.semanticModel;
  if (selected === undefined || selected.source !== "pdf" || semanticModel === undefined) {
    return { result: { status: "NOT_ALLOWED", reasonCode: "PDF_TEXT_RANGE_REQUIRED" } };
  }
  const startAnchor = part.startText ?? part.text;
  const endAnchor = part.endText ?? part.text;
  if (startAnchor === null || startAnchor === undefined
    || endAnchor === null || endAnchor === undefined) {
    return { result: { status: "NEEDS_INPUT", missing: ["target.part.text_range"] } };
  }
  const boundsBySourceObjectId = new Map<string, import("@ggulnote/editor-core").Rect>();
  for (const object of context.world.listPageObjects(context.frozenWorld.pageId)) {
    if (object.source === "pdf" && object.sourceObjectId !== undefined) {
      boundsBySourceObjectId.set(object.sourceObjectId, { ...object.bounds });
    }
  }
  const stream = buildCanonicalTextStream({
    semanticModel,
    pageId: context.frozenWorld.pageId,
    boundsBySourceObjectId,
  });
  const sourceObjectId = selected.sourceObjectId;
  const tokens = stream.tokens.filter((token) => selected.kind === "paragraph"
    ? token.paragraphId === sourceObjectId
    : selected.kind === "line"
      ? token.lineId === sourceObjectId
      : selected.kind === "word"
        ? token.sourceObjectId === sourceObjectId
        : false);
  if (tokens.length === 0) return { result: { status: "NOT_FOUND" } };
  const selectedStream = { pageId: stream.pageId, tokens };
  const query = { kind: "text_span" as const, startAnchor, endAnchor };
  const materialized = resolveTextSpanWithCanonicalStream(selectedStream, query);
  if (materialized.status !== "RESOLVED") {
    return { result: materialized.status === "AMBIGUOUS"
      ? { status: "NEEDS_INPUT", missing: ["target.part.text_range"] }
      : { status: "NOT_FOUND" } };
  }
  return {
    status: "RESOLVED",
    ref: {
      kind: "TEXT_RANGE",
      rangeId: `${ref.objectId}:range:${materialized.range.startIndex}-${materialized.range.endIndex}`,
      objectIds: [ref.objectId],
      rects: materialized.bounds.map((rect) => ({ ...rect })),
    },
  };
}

function placementDestination(
  destination: DecisionDestination,
  hasResolvedTarget = false,
): Destination | undefined {
  if (destination.relation === "CANVAS_REGION") {
    return destination.region === null ? undefined : {
      kind: "PAGE_REGION",
      region: destination.region,
      alignment: "AUTO",
      avoidOverlap: true,
    };
  }
  if ((destination.anchor === null && !hasResolvedTarget)
    || destination.relation === "BETWEEN") return undefined;
  return {
    kind: "RELATIVE",
    relation: destination.relation,
    anchor: { context: "FOCUS" },
    alignment: "START",
    distance: "NORMAL",
    avoidOverlap: true,
  };
}

function tldrawObjectIdForRef(
  ref: import("../world").EntityRef,
  context: NoteToolContext,
): string | undefined {
  const objectId = ref.kind === "OBJECT" || ref.kind === "OBJECT_PART"
    ? ref.objectId
    : undefined;
  if (objectId === undefined) return undefined;
  const object = context.world.getObject(objectId);
  return object?.source === "canvas" && object.kind === "text"
    ? object.sourceObjectId
    : undefined;
}

function rectsForRef(
  ref: import("../world").EntityRef,
  context: NoteToolContext,
): readonly import("@ggulnote/editor-core").Rect[] {
  if (ref.kind === "TEXT_RANGE") return ref.rects;
  if (ref.kind !== "OBJECT" && ref.kind !== "OBJECT_PART") return [];
  const bounds = ref.kind === "OBJECT_PART"
    ? ref.bounds ?? context.world.getObjectMetadata(ref.objectId)?.renderBounds
    : context.world.getObjectMetadata(ref.objectId)?.renderBounds;
  return bounds === undefined ? [] : [{ ...bounds }];
}

function nullableString(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : stringValue(value, path);
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new NoteAgentValidationError(path, "expected a positive integer or null");
  }
  return value as number;
}

const textCreateSchema: NoteSchema<TextCreateInput> = {
  compact: Object.freeze({
    text: "non-empty string",
    destination: "null when not requested; otherwise the explicit semantic Destination",
  }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["text", "destination", "target"]);
    return {
      text: nonEmptyString(input.text, `${path}.text`),
      ...(input.target === undefined
        ? {}
        : { target: parseActionTarget(input.target, `${path}.target`) }),
      ...(input.destination === undefined
        ? {}
        : { destination: parseToolDestination(input.destination, `${path}.destination`) }),
    };
  },
};

const targetedTextSchema: NoteSchema<TargetedTextInput> = {
  compact: Object.freeze({ target: "EntitySelector", text: "string" }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["target", "text"]);
    return {
      target: parseToolTarget(input.target, `${path}.target`),
      text: stringValue(input.text, `${path}.text`),
    };
  },
};

const annotationApplySchema: NoteSchema<AnnotationApplyInput> = {
  compact: Object.freeze({
    target: "EntitySelector",
    annotationType: "UNDERLINE|HIGHLIGHT",
    color: "optional string",
  }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["target", "annotationType", "color"]);
    const annotationType = stringValue(input.annotationType, `${path}.annotationType`);
    if (annotationType !== "UNDERLINE" && annotationType !== "HIGHLIGHT") {
      throw new NoteAgentValidationError(
        `${path}.annotationType`,
        `unsupported annotation type: ${annotationType}`,
      );
    }
    return {
      target: parseToolTarget(input.target, `${path}.target`),
      annotationType,
      ...(input.color === undefined || input.color === null
        ? {}
        : { color: nonEmptyString(input.color, `${path}.color`) }),
    };
  },
};

const emptyObjectSchema: NoteSchema<Record<string, never>> = {
  compact: Object.freeze({}),
  parse(value, path = "input") {
    strictRecord(value, path, []);
    return {};
  },
};

const preparedActionValueSchema: NoteSchema<PreparedActionValue> = {
  compact: Object.freeze({ prepared: "true" }),
  parse(value, path = "output") {
    const output = strictRecord(value, path, ["prepared"]);
    if (output.prepared !== true) {
      throw new NoteAgentValidationError(`${path}.prepared`, "expected true");
    }
    return { prepared: true };
  },
};

function strictRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NoteAgentValidationError(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NoteAgentValidationError(path, "expected a plain object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw new NoteAgentValidationError(`${path}.${unknown}`, "unexpected field");
  }
  return record;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new NoteAgentValidationError(path, "expected a string");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (result.trim().length === 0) {
    throw new NoteAgentValidationError(path, "expected a non-empty string");
  }
  return result;
}

function strictObjectSchema(
  properties: Readonly<Record<string, import("../domain").JsonValue>>,
  required: readonly string[],
): Readonly<Record<string, import("../domain").JsonValue>> {
  return Object.freeze({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
}

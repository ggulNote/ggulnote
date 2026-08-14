import {
  NoteAgentValidationError,
  parseDestination,
  parseEntitySelector,
  type Destination,
  type EntitySelector,
  type NoteToolId,
  type NoteToolResult,
} from "../domain";
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
  readonly destination?: Destination;
}

interface TargetedTextInput {
  readonly target: EntitySelector;
  readonly text: string;
}

interface AnnotationApplyInput {
  readonly target: EntitySelector;
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
    description: "Create user text with an optional declarative destination.",
    examples: ["가나다라 써 줘", "안녕하세요 아래에 가나다라 써 줘"],
    inputSchema: textCreateSchema,
    outputSchema: preparedActionValueSchema,
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
      if (input.destination?.kind === "RELATIVE") {
        const selector = "context" in input.destination.anchor
          ? { context: input.destination.anchor.context }
          : input.destination.anchor;
        const anchorStartedAt = context.metrics?.now();
        const resolved = await context.resolver.resolve(selector, context.frozenWorld);
        if (anchorStartedAt !== undefined) {
          context.metrics?.add("resolverMs", context.metrics.now() - anchorStartedAt);
        }
        const resolvedAnchor = resolved.status === "AMBIGUOUS"
          && context.candidateSelection?.stepId === context.stepId
          ? resolved.candidates.find((candidate) =>
              candidate.label === context.candidateSelection?.alias)?.ref
          : resolved.status === "RESOLVED" ? resolved.ref : undefined;
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
      const placementStartedAt = context.metrics?.now();
      const selection = context.candidateSelection;
      const selectedCandidate = selection !== undefined
        && selection.stepId === context.stepId
        ? selection.alias
        : undefined;
      const spatialDecisionInstruction = JSON.stringify({
        destination: input.destination ?? null,
      });
      const placement = await context.placement.resolve({
        ...(input.destination === undefined ? {} : { destination: input.destination }),
        ...prepared,
        worldContext: context.frozenWorld,
        ...(anchorRef === undefined ? {} : { anchorRef }),
        ...(selectedCandidate === undefined ? {} : { candidateAlias: selectedCandidate }),
        instruction: spatialDecisionInstruction,
        requirePreviewValidation: context.mode === "PRODUCTION",
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
            ...(input.destination === undefined ? {} : { destination: input.destination }),
            ...(anchorRef === undefined ? {} : { target: anchorRef }),
            ...(placement.preparedSpatial === undefined
              ? {}
              : { preparedSpatial: placement.preparedSpatial }),
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
    isAvailable: () => true,
    prepare: async (input, context) => {
      const resolved = await resolveEntitySelector(input.target, context);
      const failure = resolutionFailure(resolved);
      if (failure !== undefined) return failure;
      if (resolved.status !== "RESOLVED") {
        return { status: "FAILED", reasonCode: "UNEXPECTED_RESOLUTION" };
      }
      const capabilities = capabilitiesForRef(resolved.ref, context.world);
      if (capabilities?.editable !== true) {
        return { status: "NOT_ALLOWED", reasonCode: "TARGET_NOT_EDITABLE" };
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
    description: "Apply an underline or highlight to a grounded text target.",
    examples: ["Moreover부터 instance까지 밑줄 쳐 줘"],
    inputSchema: annotationApplySchema,
    outputSchema: preparedActionValueSchema,
    isAvailable: () => true,
    prepare: async (input, context) => {
      const resolved = await resolveEntitySelector(input.target, context);
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
    description: `${capability}.${operation} through the existing runtime boundary.`,
    examples: operation === "next_page"
      ? ["다음 페이지"]
      : operation === "previous_page" ? ["이전 페이지"] : ["방금 거 취소해"],
    inputSchema: emptyObjectSchema,
    outputSchema: preparedActionValueSchema,
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

const textCreateSchema: NoteSchema<TextCreateInput> = {
  compact: Object.freeze({
    text: "non-empty string",
    destination: "optional Destination",
  }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["text", "destination"]);
    return {
      text: nonEmptyString(input.text, `${path}.text`),
      ...(input.destination === undefined
        ? {}
        : { destination: parseDestination(input.destination, `${path}.destination`) }),
    };
  },
};

const targetedTextSchema: NoteSchema<TargetedTextInput> = {
  compact: Object.freeze({ target: "EntitySelector", text: "string" }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["target", "text"]);
    return {
      target: parseEntitySelector(input.target, `${path}.target`),
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
      target: parseEntitySelector(input.target, `${path}.target`),
      annotationType,
      ...(input.color === undefined ? {} : { color: nonEmptyString(input.color, `${path}.color`) }),
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

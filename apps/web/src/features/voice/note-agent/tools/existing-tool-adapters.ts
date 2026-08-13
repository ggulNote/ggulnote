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
  unknownOutputSchema,
} from "./note-tool-registry";

type ShadowToolOutput = {
  readonly existingCommand: Readonly<Record<string, unknown>>;
  readonly target?: unknown;
  readonly placement?: unknown;
  readonly commitAttempted: false;
};

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
  return registry;
}

function textCreateTool(): NoteTool<TextCreateInput, ShadowToolOutput> {
  return {
    id: "text.create",
    kind: "MUTATION",
    description: "Create user text with an optional declarative destination.",
    inputSchema: textCreateSchema,
    outputSchema: unknownOutputSchema as NoteSchema<ShadowToolOutput>,
    isAvailable: (context) =>
      context.placement !== undefined && context.preparePlacement !== undefined,
    execute: async (input, context) => {
      if (context.placement === undefined || context.preparePlacement === undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "PLACEMENT_UNAVAILABLE" };
      }
      const prepared = await context.preparePlacement("text.create", input);
      if (prepared === undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "MEASUREMENT_UNAVAILABLE" };
      }
      const placement = await context.placement.resolve({
        ...(input.destination === undefined ? {} : { destination: input.destination }),
        ...prepared,
        worldContext: context.frozenWorld,
      });
      if (placement.status === "AMBIGUOUS") {
        return { status: "AMBIGUOUS", candidates: placement.candidates };
      }
      if (placement.status === "NO_FEASIBLE_PLACEMENT") {
        return { status: "NO_FEASIBLE_PLACEMENT" };
      }
      if (placement.status === "STALE_SCENE") return { status: "STALE_SCENE" };
      return {
        status: "SUCCESS",
        data: {
          existingCommand: {
            capability: "text",
            operation: "create",
            payload: { text: input.text },
          },
          placement: placement.placement,
          commitAttempted: false,
        },
      };
    },
  };
}

function textReplaceTool(): NoteTool<TargetedTextInput, ShadowToolOutput> {
  return {
    id: "text.replace",
    kind: "MUTATION",
    description: "Replace content of an editable user text object.",
    inputSchema: targetedTextSchema,
    outputSchema: unknownOutputSchema as NoteSchema<ShadowToolOutput>,
    isAvailable: () => true,
    execute: async (input, context) => {
      const resolved = await context.resolver.resolve(input.target, context.frozenWorld);
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
        status: "SUCCESS",
        data: {
          existingCommand: {
            capability: "text",
            operation: "replace_content",
            payload: { text: input.text },
          },
          target: resolved.ref,
          commitAttempted: false,
        },
      };
    },
  };
}

function annotationApplyTool(): NoteTool<AnnotationApplyInput, ShadowToolOutput> {
  return {
    id: "annotation.apply",
    kind: "MUTATION",
    description: "Apply an underline or highlight to a grounded text target.",
    inputSchema: annotationApplySchema,
    outputSchema: unknownOutputSchema as NoteSchema<ShadowToolOutput>,
    isAvailable: () => true,
    execute: async (input, context) => {
      const resolved = await context.resolver.resolve(input.target, context.frozenWorld);
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
        status: "SUCCESS",
        data: {
          existingCommand: {
            capability: "annotation",
            operation: input.annotationType === "UNDERLINE" ? "underline" : "highlight",
            payload: input.color === undefined ? {} : { color: input.color },
          },
          target: resolved.ref,
          commitAttempted: false,
        },
      };
    },
  };
}

function controlTool(
  id: NoteToolId,
  capability: string,
  operation: string,
): NoteTool<Record<string, never>, ShadowToolOutput> {
  return {
    id,
    kind: "MUTATION",
    description: `${capability}.${operation} through the existing runtime boundary.`,
    inputSchema: emptyObjectSchema,
    outputSchema: unknownOutputSchema as NoteSchema<ShadowToolOutput>,
    isAvailable: () => true,
    execute: async () => ({
      status: "SUCCESS",
      data: {
        existingCommand: { capability, operation, payload: {} },
        commitAttempted: false,
      },
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

import {
  NoteAgentValidationError,
  parseEntitySelector,
  type EntitySelector,
} from "../domain";
import type { NoteSchema, NoteTool } from "./note-tool-registry";

interface ExtensionInput {
  readonly target: EntitySelector;
}

/** Contracts exist, but are intentionally unavailable until editor adapters exist. */
export function createUnavailableExtensionTools(): readonly NoteTool[] {
  return [unavailable("graph.add_tangent"), unavailable("table.update_cell")];
}

function unavailable(id: "graph.add_tangent" | "table.update_cell"): NoteTool<ExtensionInput> {
  return {
    id,
    kind: "MUTATION",
    description: `${id} requires a future stable editor capability adapter.`,
    examples: id === "graph.add_tangent"
      ? ["첫 번째 그래프에 x=1 접선 그어 줘"]
      : ["표의 2행 3열을 바꿔 줘"],
    inputSchema: targetSchema,
    outputSchema: unavailableOutputSchema,
    isAvailable: () => false,
    prepare: async () => ({ status: "NOT_ALLOWED", reasonCode: "EDITOR_CAPABILITY_UNAVAILABLE" }),
  };
}

const targetSchema: NoteSchema<ExtensionInput> = {
  compact: Object.freeze({ target: "EntitySelector with deterministic part criteria" }),
  parse(value, path = "input") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new NoteAgentValidationError(path, "expected an object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NoteAgentValidationError(path, "expected a plain object");
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "target")) {
      throw new NoteAgentValidationError(path, "unexpected field");
    }
    return { target: parseEntitySelector(record.target, `${path}.target`) };
  },
};

const unavailableOutputSchema: NoteSchema<never> = {
  compact: Object.freeze({}),
  parse(_value, path = "output"): never {
    throw new NoteAgentValidationError(path, "unavailable action has no output");
  },
};

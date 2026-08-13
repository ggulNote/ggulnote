import { parseEntitySelector, type EntitySelector } from "../domain";
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
    inputSchema: targetSchema,
    outputSchema: { compact: Object.freeze({}), parse: (value) => value },
    isAvailable: () => false,
    execute: async () => ({ status: "NOT_ALLOWED", reasonCode: "EDITOR_CAPABILITY_UNAVAILABLE" }),
  };
}

const targetSchema: NoteSchema<ExtensionInput> = {
  compact: Object.freeze({ target: "EntitySelector with deterministic part criteria" }),
  parse(value, path = "input") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(`${path}: expected an object`);
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "target")) {
      throw new TypeError(`${path}: unexpected field`);
    }
    return { target: parseEntitySelector(record.target, `${path}.target`) };
  },
};

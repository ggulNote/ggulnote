import type { SpatialSceneSnapshot } from "../../domain";
import type {
  CompactToolSchema,
  NoteToolId,
  NoteToolKind,
  NoteToolResult,
} from "../domain";
import type {
  ExistingPlacementEngine,
} from "../runtime/placement-engine";
import type {
  ExistingWorldResolver,
  FrozenWorldContext,
  UnifiedObjectWorld,
} from "../world";
import type { MeasuredDraft, PlacementProfile } from "../../domain";

export interface NoteSchema<T> {
  parse(value: unknown, path?: string): T;
  readonly compact: Readonly<Record<string, string>>;
}

export interface NotePlacementPreparation {
  readonly snapshot: SpatialSceneSnapshot;
  readonly draft: MeasuredDraft;
  readonly profile: PlacementProfile;
}

export interface NoteToolContext {
  readonly mode: "SHADOW";
  readonly turnId: string;
  readonly frozenWorld: FrozenWorldContext;
  readonly world: UnifiedObjectWorld;
  readonly resolver: ExistingWorldResolver;
  readonly placement?: ExistingPlacementEngine;
  readonly getCurrentSceneRevision: () => number;
  readonly preparePlacement?: (
    toolId: NoteToolId,
    input: unknown,
  ) => Promise<NotePlacementPreparation | undefined>;
}

export interface NoteTool<TInput = unknown, TOutput = unknown> {
  readonly id: NoteToolId;
  readonly kind: NoteToolKind;
  readonly description: string;
  readonly inputSchema: NoteSchema<TInput>;
  readonly outputSchema: NoteSchema<TOutput>;
  isAvailable(context: NoteToolContext): boolean;
  execute(input: TInput, context: NoteToolContext): Promise<NoteToolResult<TOutput>>;
}

export class NoteToolRegistry {
  private readonly tools = new Map<NoteToolId, NoteTool>();

  public register<TInput, TOutput>(tool: NoteTool<TInput, TOutput>): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate NoteTool registration: ${tool.id}`);
    }
    this.tools.set(tool.id, tool as NoteTool);
  }

  public get(toolId: NoteToolId): NoteTool | undefined {
    return this.tools.get(toolId);
  }

  public listAvailable(context: NoteToolContext): readonly NoteTool[] {
    return Object.freeze([...this.tools.values()].filter((tool) => tool.isAvailable(context)));
  }

  public compactSchemas(context: NoteToolContext): readonly CompactToolSchema[] {
    return Object.freeze(this.listAvailable(context).map((tool) => Object.freeze({
      id: tool.id,
      kind: tool.kind,
      description: tool.description,
      input: tool.inputSchema.compact,
    })));
  }
}

export const unknownOutputSchema: NoteSchema<unknown> = Object.freeze({
  compact: Object.freeze({}),
  parse: (value: unknown) => value,
});

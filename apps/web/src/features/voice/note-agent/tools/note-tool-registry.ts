import type { SpatialSceneSnapshot } from "../../domain";
import type {
  CompactToolSchema,
  NoteActionPrepareResult,
  NoteToolId,
  NoteToolKind,
} from "../domain";
import type {
  ExistingPlacementEngine,
} from "../runtime/placement-engine";
import type {
  ExistingWorldResolver,
  FrozenWorldContext,
  UnifiedObjectWorld,
  WorldResolutionResult,
} from "../world";
import type { EntitySelector } from "../domain";
import type { MeasuredDraft, PlacementProfile } from "../../domain";
import type {
  NoteRuntimeMetricsSink,
} from "../runtime/note-runtime-metrics";

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
  readonly mode: "SHADOW" | "PRODUCTION";
  readonly turnId: string;
  readonly frozenWorld: FrozenWorldContext;
  readonly world: UnifiedObjectWorld;
  readonly resolver: ExistingWorldResolver;
  readonly placement?: ExistingPlacementEngine;
  readonly getCurrentSceneRevision: () => number;
  readonly signal?: AbortSignal;
  readonly stepId?: string;
  readonly candidateSelection?: {
    readonly stepId: string;
    readonly alias: `${"C" | "S"}${number}`;
  };
  readonly metrics?: NoteRuntimeMetricsSink;
  readonly productionPlacementAvailable?: boolean;
  readonly preparePlacement?: (
    toolId: NoteToolId,
    input: unknown,
  ) => Promise<NotePlacementPreparation | undefined>;
}

export interface NoteRuntimeContext extends NoteToolContext {
  readonly transaction?: NoteTransactionPort;
}

export interface NoteTransactionStep {
  readonly stepId: string;
  readonly toolId: NoteToolId;
  readonly operation: import("../domain").PreparedNoteOperation;
}

export interface NoteTransactionReceipt {
  readonly kind: "COMMITTED" | "NAVIGATED" | "UNDONE";
  readonly planId?: string;
  readonly operationId?: string;
  readonly annotationId?: string;
  readonly direction?: "next_page" | "previous_page";
  readonly guardMs: number;
  readonly commitMs: number;
  readonly visualMs: number;
  readonly visualCallCount?: 0 | 1;
}

export type NoteTransactionResult =
  | {
      readonly status: "SUCCESS";
      readonly receipt: NoteTransactionReceipt;
      readonly commitAttempted: true;
    }
  | { readonly status: "NOT_FOUND"; readonly commitAttempted: boolean }
  | { readonly status: "NO_FEASIBLE_PLACEMENT"; readonly commitAttempted: boolean }
  | { readonly status: "STALE_SCENE"; readonly commitAttempted: boolean }
  | {
      readonly status: "NEEDS_INPUT";
      readonly missing: readonly string[];
      readonly commitAttempted: false;
    }
  | { readonly status: "NOT_ALLOWED"; readonly reasonCode: string; readonly commitAttempted: boolean }
  | { readonly status: "FAILED"; readonly reasonCode: string; readonly commitAttempted: boolean };

export interface NoteTransactionPort {
  commit(input: {
    readonly turnId: string;
    readonly frozenWorld: FrozenWorldContext;
    readonly steps: readonly NoteTransactionStep[];
    readonly signal?: AbortSignal;
  }): Promise<NoteTransactionResult>;
}

export interface NoteTool<TInput = unknown, TOutput = unknown> {
  readonly id: NoteToolId;
  readonly kind: NoteToolKind;
  readonly description: string;
  readonly examples: readonly string[];
  readonly inputSchema: NoteSchema<TInput>;
  readonly outputSchema: NoteSchema<TOutput>;
  isAvailable(context: NoteToolContext): boolean;
  prepare(
    input: TInput,
    context: NoteToolContext,
  ): Promise<NoteActionPrepareResult<TOutput>>;
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
      examples: Object.freeze([...tool.examples]),
      input: tool.inputSchema.compact,
    })));
  }
}

export type RegisteredActionDefinition = CompactToolSchema;

export interface ActionLoadContext {
  readonly toolContext: NoteToolContext;
}

export interface ActionContextLoader {
  loadActions(
    context: ActionLoadContext,
  ): Promise<readonly RegisteredActionDefinition[]>;
}

/** Phase 4 starts simple: every enabled registered action is supplied once. */
export class AllEnabledActionsLoader implements ActionContextLoader {
  public constructor(private readonly registry: NoteToolRegistry) {}

  public loadActions(
    context: ActionLoadContext,
  ): Promise<readonly RegisteredActionDefinition[]> {
    return Promise.resolve(this.registry.compactSchemas(context.toolContext));
  }
}

export const unknownOutputSchema: NoteSchema<unknown> = Object.freeze({
  compact: Object.freeze({}),
  parse: (value: unknown) => value,
});

export async function resolveEntitySelector(
  selector: EntitySelector,
  context: NoteToolContext,
): Promise<WorldResolutionResult> {
  const startedAt = context.metrics?.now();
  const result = await context.resolver.resolve(selector, context.frozenWorld);
  if (startedAt !== undefined) {
    context.metrics?.add("resolverMs", context.metrics.now() - startedAt);
  }
  const selection = context.candidateSelection;
  if (
    result.status !== "AMBIGUOUS"
    || selection === undefined
    || selection.stepId !== context.stepId
  ) return result;
  const selected = result.candidates.find((candidate) => candidate.label === selection.alias);
  return selected === undefined
    ? result
    : { status: "RESOLVED", ref: selected.ref };
}

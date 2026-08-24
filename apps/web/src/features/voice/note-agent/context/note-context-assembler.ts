import {
  describeSceneObject,
  type Rect,
  type SceneSnapshot,
} from "@ggulnote/editor-core";
import type { CompletedVoiceTurn } from "../../domain";
import type {
  DecisionContextFragment,
  JsonValue,
  NoteCatalogObject,
  NoteContextPartId,
  NoteDecisionInput,
  PageBaseSnapshot,
} from "../domain";
import type {
  ActionContextLoader,
  NoteToolContext,
} from "../tools";
import type {
  EntityRef,
  FrozenWorldContext,
  UnifiedObjectWorld,
} from "../world";
import {
  NoteObjectHandleMap,
  projectObjectDetail,
  projectCatalogObject,
  projectObjectSummary,
  type ObjectDetail,
  type ObjectSummary,
} from "./object-projection";
import { PageAgentContextCache } from "./page-agent-context-cache";

const DEFAULT_CONTEXT_TOKEN_BUDGET = 16_000;
const MAX_TRANSCRIPT_CHARS = 4_000;
const MAX_RECENT_OPERATIONS = 3;
const REQUIRED_PART_IDS = new Set<NoteContextPartId>([
  "user-turn",
  "frozen-context",
  "object-catalog",
]);

export interface NoteContextCollectionContext {
  readonly turn: CompletedVoiceTurn;
  readonly documentId: string;
  readonly frozenWorld: FrozenWorldContext;
  readonly world: UnifiedObjectWorld;
  readonly handles: NoteObjectHandleMap;
  readonly pageContextCache: PageAgentContextCache;
  readonly viewport?: Rect;
  readonly detailHandles?: readonly ("selection" | "focus")[];
  readonly candidates?: readonly CandidatePartEntry[];
  readonly screenshotCrop?: ScreenshotCropDescriptor;
}

export interface NoteContextPartProvider<TPart> {
  readonly id: NoteContextPartId;
  readonly priority: number;
  collect(
    context: NoteContextCollectionContext,
  ): TPart | null | Promise<TPart | null>;
  toDecisionContent(part: TPart): JsonValue;
}

export interface CandidatePartEntry {
  readonly handle: `candidate:${"C" | "S"}${number}`;
  readonly ref: EntityRef;
  readonly kind?: string;
  readonly source?: string;
  readonly contentSummary?: string;
  readonly relativeRegion?: string;
  readonly bounds?: Rect;
  readonly evidenceSummary?: string;
}

export interface ScreenshotCropDescriptor {
  readonly handle: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly candidateHandles: readonly `candidate:S${number}`[];
}

export interface NoteContextAssembly {
  readonly decisionInput: NoteDecisionInput;
  readonly parts: readonly DecisionContextFragment[];
  readonly handles: NoteObjectHandleMap;
  readonly estimatedTokens: number;
  readonly objectCatalogBuildMs: number;
  readonly objectCatalogObjectCount: number;
  readonly objectCatalogSerializedChars: number;
}

export interface NoteContextAssemblerOptions {
  readonly actionLoader: ActionContextLoader;
  readonly providers?: readonly NoteContextPartProvider<unknown>[];
  readonly tokenBudget?: number;
  readonly pageContextCache?: PageAgentContextCache;
  readonly now?: () => number;
}

export interface NotePageActivationInput {
  readonly documentId: string;
  readonly pageId: string;
  readonly contextRevision: number;
  readonly createdAt: number;
  readonly scene: SceneSnapshot;
}

/** Collects every Prompt Part locally and makes exactly one Decision input. */
export class NoteContextAssembler {
  private readonly providers: readonly NoteContextPartProvider<unknown>[];
  private readonly tokenBudget: number;
  private readonly pageContextCache: PageAgentContextCache;
  private readonly now: () => number;

  public constructor(private readonly options: NoteContextAssemblerOptions) {
    this.providers = options.providers ?? defaultPartProviders();
    this.pageContextCache = options.pageContextCache ?? new PageAgentContextCache();
    this.now = options.now ?? Date.now;
    this.tokenBudget = positiveInteger(
      options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
      "tokenBudget",
    );
    const ids = this.providers.map((provider) => provider.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Duplicate NoteContextPartProvider id.");
    }
  }

  public activatePage(input: NotePageActivationInput): PageBaseSnapshot | null {
    if (input.scene.page.id !== input.pageId) return null;
    const world = createActivationWorld(input.documentId, input.scene);
    const objects = projectPageObjectCatalog({
      documentId: input.documentId,
      pageId: input.pageId,
      sceneRevision: input.scene.sceneRevision,
      world,
      pageContextCache: this.pageContextCache,
    });
    if (objects === undefined) return null;
    return this.pageContextCache.activate({
      documentId: input.documentId,
      pageId: input.pageId,
      contextRevision: input.contextRevision,
      sceneMode: input.scene.mode,
      objects,
      persistedAt: input.createdAt,
    });
  }

  public async assemble(input: {
    readonly turn: CompletedVoiceTurn;
    readonly documentId: string;
    readonly frozenWorld: FrozenWorldContext;
    readonly world: UnifiedObjectWorld;
    readonly toolContext: NoteToolContext;
    readonly viewport?: Rect;
    readonly detailHandles?: readonly ("selection" | "focus")[];
    readonly candidates?: readonly CandidatePartEntry[];
    readonly screenshotCrop?: ScreenshotCropDescriptor;
  }): Promise<NoteContextAssembly> {
    const handles = new NoteObjectHandleMap();
    const collection: NoteContextCollectionContext = {
      turn: input.turn,
      documentId: input.documentId,
      frozenWorld: input.frozenWorld,
      world: input.world,
      handles,
      pageContextCache: this.pageContextCache,
      ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
      ...(input.detailHandles === undefined ? {} : { detailHandles: input.detailHandles }),
      ...(input.candidates === undefined ? {} : { candidates: input.candidates }),
      ...(input.screenshotCrop === undefined ? {} : { screenshotCrop: input.screenshotCrop }),
    };
    const availableTools = await this.options.actionLoader.loadActions({
      toolContext: input.toolContext,
    });
    const providerDurations = new Map<NoteContextPartId, number>();
    const collected = await Promise.all(this.providers.map(async (provider) => {
      const providerStartedAt = monotonicNow();
      const part = await provider.collect(collection);
      providerDurations.set(provider.id, Math.max(0, monotonicNow() - providerStartedAt));
      return part === null ? undefined : {
        id: provider.id,
        priority: provider.priority,
        content: provider.toDecisionContent(part),
      } satisfies DecisionContextFragment;
    }));
    const ordered = collected
      .filter((part): part is DecisionContextFragment => part !== undefined)
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const parts: DecisionContextFragment[] = [];
    let estimatedTokens = estimateTokens(availableTools);
    if (estimatedTokens > this.tokenBudget) {
      throw new Error("Enabled Note action schemas exceed context token budget.");
    }
    for (const part of ordered) {
      const partTokens = estimateTokens(part);
      if (
        !REQUIRED_PART_IDS.has(part.id)
        && estimatedTokens + partTokens > this.tokenBudget
      ) continue;
      if (
        REQUIRED_PART_IDS.has(part.id)
        && estimatedTokens + partTokens > this.tokenBudget
      ) throw new Error("Required Note context exceeds token budget.");
      parts.push(Object.freeze(part));
      estimatedTokens += partTokens;
    }
    for (const required of REQUIRED_PART_IDS) {
      if (!parts.some((part) => part.id === required)) {
        throw new Error(`Required Note context part missing: ${required}`);
      }
    }
    const focus = summaryFromPart(parts, "selection-focus", "focus");
    const selection = summaryFromPart(parts, "selection-focus", "selection");
    const lastOperation = lastOperationFromPart(parts);
    const objectCatalog = objectCatalogFromPart(parts);
    const pageContext = this.pageContextCache.build({
      documentId: input.documentId,
      pageId: input.frozenWorld.pageId,
      sceneRevision: input.frozenWorld.sceneRevision,
      sceneMode: input.frozenWorld.frozenVoiceContext.sceneMode,
      objects: objectCatalog,
      ...(lastOperation === undefined ? {} : { lastOperation }),
      createdAt: this.now(),
    });
    const decisionInput: NoteDecisionInput = {
      turn: {
        turnId: input.turn.id,
        language: input.turn.language,
        rawFinalTranscript: sanitizeTranscript(input.turn.rawTranscript),
      },
      frozenContext: {
        documentId: input.documentId,
        pageId: input.frozenWorld.pageId,
        sceneRevision: input.frozenWorld.sceneRevision,
        sceneMode: input.frozenWorld.frozenVoiceContext.sceneMode,
        ...(selection === undefined ? {} : { selection }),
        ...(focus === undefined ? {} : { focus }),
        ...(lastOperation === undefined ? {} : { lastOperation }),
      },
      availableTools,
      pageBase: pageContext.pageBase,
      liveScene: pageContext.liveScene,
      objectCatalog: {
        objects: objectCatalog,
        truncated: false,
      },
    };
    return Object.freeze({
      decisionInput,
      parts: Object.freeze(parts),
      handles,
      estimatedTokens,
      objectCatalogBuildMs: providerDurations.get("object-catalog") ?? 0,
      objectCatalogObjectCount: objectCatalog.length,
      objectCatalogSerializedChars: JSON.stringify(objectCatalog).length,
    });
  }
}

function defaultPartProviders(): readonly NoteContextPartProvider<unknown>[] {
  return Object.freeze([
    userTurnProvider,
    frozenContextProvider,
    objectCatalogProvider,
    selectionFocusProvider,
    recentOperationProvider,
    objectDetailProvider,
    candidateProvider,
    screenshotCropProvider,
  ]);
}

const userTurnProvider: NoteContextPartProvider<{
  readonly turnId: string;
  readonly language: string;
  readonly rawFinalTranscript: string;
}> = {
  id: "user-turn",
  priority: 100,
  collect: (context) => ({
    turnId: context.turn.id,
    language: context.turn.language,
    rawFinalTranscript: sanitizeTranscript(context.turn.rawTranscript),
  }),
  toDecisionContent: toJson,
};

const objectCatalogProvider: NoteContextPartProvider<readonly NoteCatalogObject[]> = {
  id: "object-catalog",
  priority: 85,
  collect: (context) => projectPageObjectCatalog({
    documentId: context.documentId,
    pageId: context.frozenWorld.pageId,
    sceneRevision: context.frozenWorld.sceneRevision,
    world: context.world,
    pageContextCache: context.pageContextCache,
    handles: context.handles,
    selectionId: objectIdFor(context.frozenWorld.selection),
    focusId: objectIdFor(context.frozenWorld.focus),
  }) ?? [],
  toDecisionContent: toJson,
};

const frozenContextProvider: NoteContextPartProvider<Record<string, unknown>> = {
  id: "frozen-context",
  priority: 90,
  collect: (context) => ({
    documentId: context.documentId,
    pageId: context.frozenWorld.pageId,
    sceneRevision: context.frozenWorld.sceneRevision,
    sceneMode: context.frozenWorld.frozenVoiceContext.sceneMode,
    ...(context.viewport === undefined
      ? {}
      : {
          viewport: {
            handle: "viewport:V1",
            bounds: { ...context.viewport },
          },
        }),
  }),
  toDecisionContent: toJson,
};

const selectionFocusProvider: NoteContextPartProvider<Record<string, ObjectSummary>> = {
  id: "selection-focus",
  priority: 80,
  collect: (context) => {
    const output: Record<string, ObjectSummary> = {};
    addContextSummary("selection", context.frozenWorld.selection, context, output);
    addContextSummary("focus", context.frozenWorld.focus, context, output);
    return Object.keys(output).length === 0 ? null : output;
  },
  toDecisionContent: toJson,
};

const recentOperationProvider: NoteContextPartProvider<readonly Record<string, unknown>[]> = {
  id: "recent-operations",
  priority: 70,
  collect: (context) => {
    const records = (context.world.getRecentOperations?.({
      pageId: context.frozenWorld.pageId,
      limit: MAX_RECENT_OPERATIONS,
    }) ?? []).slice(0, MAX_RECENT_OPERATIONS);
    const recent = records.flatMap((record, index) => {
      const ref = record.outputRefs[0];
      if (ref === undefined) return [];
      const handle = `recent:${index + 1}`;
      const summary = projectObjectSummary(handle, ref, context.world);
      if (summary === undefined) return [];
      context.handles.register(handle, ref);
      return [{
        handle,
        toolId: record.toolId,
        object: summary,
      }];
    });
    return recent.length === 0 ? null : recent;
  },
  toDecisionContent: toJson,
};

const objectDetailProvider: NoteContextPartProvider<readonly ObjectDetail[]> = {
  id: "object-detail",
  priority: 40,
  collect: (context) => {
    const details = (context.detailHandles ?? []).flatMap((handle) => {
      const ref = context.handles.resolve(handle);
      const detail = ref === undefined
        ? undefined
        : projectObjectDetail(handle, ref, context.world);
      if (ref !== undefined && detail !== undefined) {
        registerPartHandles(handle, ref, detail, context);
      }
      return detail === undefined ? [] : [detail];
    });
    return details.length === 0 ? null : details;
  },
  toDecisionContent: toJson,
};

const candidateProvider: NoteContextPartProvider<readonly Record<string, unknown>[]> = {
  id: "candidates",
  priority: 30,
  collect: (context) => {
    const candidates = context.candidates?.slice(0, 6).map((candidate) => {
      context.handles.register(candidate.handle, candidate.ref);
      return {
        handle: candidate.handle,
        ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
        ...(candidate.source === undefined ? {} : { source: candidate.source }),
        ...(candidate.contentSummary === undefined
          ? {}
          : { contentSummary: candidate.contentSummary.slice(0, 160) }),
        ...(candidate.relativeRegion === undefined
          ? {}
          : { relativeRegion: candidate.relativeRegion }),
        ...(candidate.bounds === undefined ? {} : { bounds: { ...candidate.bounds } }),
        ...(candidate.evidenceSummary === undefined
          ? {}
          : { evidenceSummary: candidate.evidenceSummary.slice(0, 160) }),
      };
    }) ?? [];
    return candidates.length === 0 ? null : candidates;
  },
  toDecisionContent: toJson,
};

const screenshotCropProvider: NoteContextPartProvider<ScreenshotCropDescriptor> = {
  id: "screenshot-crop",
  priority: 20,
  collect: (context) => context.screenshotCrop ?? null,
  toDecisionContent: toJson,
};

function addContextSummary(
  handle: "selection" | "focus",
  ref: EntityRef | undefined,
  context: NoteContextCollectionContext,
  output: Record<string, ObjectSummary>,
): void {
  if (ref === undefined) return;
  const summary = projectObjectSummary(handle, ref, context.world);
  if (summary === undefined) return;
  context.handles.register(handle, ref);
  output[handle] = summary;
}

function registerPartHandles(
  handle: "selection" | "focus",
  ref: EntityRef,
  detail: ObjectDetail,
  context: NoteContextCollectionContext,
): void {
  const objectId = ref.kind === "OBJECT" || ref.kind === "OBJECT_PART"
    ? ref.objectId
    : ref.kind === "TEXT_RANGE" ? ref.objectIds[0] : undefined;
  if (objectId === undefined || detail.parts === undefined) return;
  const sourceParts = context.world.getObjectMetadata(objectId)?.parts ?? [];
  detail.parts.forEach((part, index) => {
    const sourcePart = sourceParts[index];
    if (sourcePart === undefined) return;
    context.handles.register(part.handle, {
      kind: "OBJECT_PART",
      objectId,
      partId: sourcePart.partId,
      ...(sourcePart.bounds === undefined ? {} : { bounds: { ...sourcePart.bounds } }),
    });
  });
}

function summaryFromPart(
  parts: readonly DecisionContextFragment[],
  partId: NoteContextPartId,
  handle: "selection" | "focus",
): NoteDecisionInput["frozenContext"]["focus"] | undefined {
  const part = parts.find((entry) => entry.id === partId)?.content;
  if (!isJsonRecord(part)) return undefined;
  const value = part[handle];
  if (!isJsonRecord(value)) return undefined;
  return {
    ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
    ...(typeof value.contentSummary === "string"
      ? { textPreview: value.contentSummary }
      : {}),
  };
}

function lastOperationFromPart(
  parts: readonly DecisionContextFragment[],
): NoteDecisionInput["frozenContext"]["lastOperation"] | undefined {
  const content = parts.find((entry) => entry.id === "recent-operations")?.content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0];
  if (!isJsonRecord(first)) return undefined;
  const object = first.object;
  return typeof first.toolId !== "string"
    ? undefined
    : {
        toolId: first.toolId as `${string}.${string}`,
        ...(isJsonRecord(object) && typeof object.kind === "string"
          ? { outputKind: object.kind }
          : {}),
        ...(isJsonRecord(object) && typeof object.contentSummary === "string"
          ? { summary: object.contentSummary }
          : {}),
      };
}

function objectCatalogFromPart(
  parts: readonly DecisionContextFragment[],
): readonly NoteCatalogObject[] {
  const content = parts.find((entry) => entry.id === "object-catalog")?.content;
  if (!Array.isArray(content)) return [];
  return content as unknown as readonly NoteCatalogObject[];
}

function objectIdFor(ref: EntityRef | undefined): string | undefined {
  if (ref?.kind === "OBJECT" || ref?.kind === "OBJECT_PART") return ref.objectId;
  return ref?.kind === "TEXT_RANGE" ? ref.objectIds[0] : undefined;
}

function isCatalogObject(object: ReturnType<UnifiedObjectWorld["listPageObjects"]>[number]): boolean {
  if (object.source === "canvas") return true;
  return object.kind === "paragraph"
    || object.kind === "image"
    || object.kind === "table"
    || (object.kind === "pdf-region"
      && /figure|table|equation|image/iu.test(object.regionType));
}

function projectPageObjectCatalog(input: {
  readonly documentId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly world: UnifiedObjectWorld;
  readonly pageContextCache: PageAgentContextCache;
  readonly handles?: NoteObjectHandleMap;
  readonly selectionId?: string;
  readonly focusId?: string;
}): readonly NoteCatalogObject[] | undefined {
  const scene = input.world.getSnapshot(input.pageId, input.sceneRevision);
  if (scene === undefined) return undefined;
  const objects = input.world.listPageObjects(input.pageId)
    .filter(isCatalogObject)
    .sort((left, right) => {
      if (left.source !== right.source) return left.source === "canvas" ? -1 : 1;
      return left.zIndex - right.zIndex || left.id.localeCompare(right.id);
    });
  const recentIds = new Set(objects
    .filter((object) => object.source === "canvas")
    .sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0)
      - (left.updatedAt ?? left.createdAt ?? 0))
    .slice(0, MAX_RECENT_OPERATIONS)
    .map((object) => object.id));
  return objects.flatMap((object) => {
    const handle = input.pageContextCache.handleFor(
      input.documentId,
      input.pageId,
      object.id,
    );
    const ref: EntityRef = { kind: "OBJECT", objectId: object.id };
    const projected = projectCatalogObject(handle, ref, input.world, scene.page, {
      selected: object.id === input.selectionId,
      focused: object.id === input.focusId,
      recent: recentIds.has(object.id),
    });
    if (projected === undefined) return [];
    input.handles?.register(handle, ref);
    return [projected];
  });
}

function createActivationWorld(
  documentId: string,
  scene: SceneSnapshot,
): UnifiedObjectWorld {
  return {
    getSnapshot: (pageId, sceneRevision) =>
      pageId === scene.page.id && sceneRevision === scene.sceneRevision
        ? scene
        : undefined,
    getObject: (objectId) => scene.objectById[objectId],
    getObjectMetadata: (objectId) => {
      const object = scene.objectById[objectId];
      return object === undefined
        ? undefined
        : describeSceneObject(object, { documentId });
    },
    listPageObjects: (pageId) => pageId === scene.page.id ? scene.objects : [],
    searchIndex: () => [],
    getRecentOperations: () => [],
    getRecentOperationOutputs: () => [],
  };
}

export function sanitizeTranscript(value: string): string {
  return value.normalize("NFC").trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Context contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value !== "object") throw new TypeError("Context contains a non-JSON value.");
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
    entry === undefined ? [] : [[key, toJson(entry)]]));
}

function isJsonRecord(value: JsonValue | undefined): value is {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

import type { EditorEngine } from "@ggulnote/editor-core";
import type { InteractionClock } from "@ggulnote/interaction-core";
import {
  CurrentRevisionSceneSnapshotSource,
  ExistingSceneSpatialSceneSource,
  InMemorySpatialCommandCapabilityRegistry,
  InMemorySpatialPreviewRendererRegistry,
  MultimodalPlacementObservationBuilder,
  BoundedMultimodalPlacementResolver,
  PreviewValidationOrchestrator,
  SpatialPlacementExecutionPipeline,
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
  DirectCommandPlanningPipeline,
  DirectCommandRoute,
  DirectCommandTraceStore,
  FrozenTargetResolver,
  GroundedTargetRecovery,
  BoundedSpeechRefiner,
} from "../application";
import type {
  FrozenPageGroundingSnapshot,
  ReadyForDirectCommandExecution,
} from "../domain";
import {
  HttpDirectCommandPlannerProvider,
  HttpDirectTargetDisambiguatorProvider,
  type DirectCommandPlannerProvider,
  type DirectTargetDisambiguatorProvider,
  type GroundedTargetRecoveryProvider,
  type MultimodalPlacementJudgeProvider,
  type SpeechRefinerProvider,
} from "../providers";
import {
  createDocumentSessionDirectCommandNavigationPort,
  EditorDirectCommandExecutor,
} from "./editor-direct-command-executor";
import { EditorDirectRecentOperationsSource } from "./editor-direct-recent-operations-source";
import { BrowserSpatialObservationImageProcessor } from "./browser-spatial-observation-image-processor";
import { CanvasAnnotationSpatialPreviewRenderer } from "./canvas-annotation-spatial-preview-renderer";
import { CanvasSpatialScreenshotSource } from "./canvas-spatial-screenshot-source";
import { TextSpatialCreateCapability } from "./text-spatial-create-capability";
import {
  createExistingNoteToolRegistry,
  DirectCommandOperationLedgerAdapter,
  ExistingPlacementEngine,
  ExistingSceneUnifiedObjectWorldSource,
  ExistingUnifiedObjectWorld,
  ExistingWorldResolver,
  NoteAgentShadowRoute,
  type NoteDecisionProvider,
  type FrozenWorldContext,
  type NoteToolContext,
} from "../note-agent";

export interface EditorSpatialPlacementCompositionOptions {
  getBaseCanvas(): HTMLCanvasElement | null;
  getOverlayCanvas(): HTMLCanvasElement | null;
  mountPreviewCanvas(canvas: HTMLCanvasElement): void | (() => void);
  placementJudge?: MultimodalPlacementJudgeProvider;
}

export interface EditorDirectCommandCompositionOptions {
  editorEngine: EditorEngine;
  clock: Pick<InteractionClock, "now">;
  readCurrentGroundingSnapshot(): FrozenPageGroundingSnapshot | undefined;
  getCurrentSceneRevision(): number;
  getCurrentPage(): number;
  goToPage(page: number): void;
  planner?: DirectCommandPlannerProvider;
  disambiguator?: DirectTargetDisambiguatorProvider;
  recovery?: GroundedTargetRecoveryProvider;
  speechRefiner?: SpeechRefinerProvider;
  targetResolver?: FrozenTargetResolver;
  spatial?: EditorSpatialPlacementCompositionOptions;
  noteAgentShadow?: {
    readonly enabled: boolean;
    readonly provider: NoteDecisionProvider;
  };
}

export interface EditorDirectCommandComposition {
  route: DirectCommandRoute;
  traces: DirectCommandTraceStore;
  noteAgentShadow?: NoteAgentShadowRoute;
  dispose(): void;
}

export function createEditorDirectCommandComposition(
  options: EditorDirectCommandCompositionOptions,
): EditorDirectCommandComposition {
  const recentOperations = new EditorDirectRecentOperationsSource({
    editorEngine: options.editorEngine,
  });
  const contextBuilder = new DirectCommandContextBuilder({
    frozenSceneSource: new CurrentRevisionSceneSnapshotSource(
      options.readCurrentGroundingSnapshot,
    ),
    recentOperationsSource: recentOperations,
  });
  const resolver = options.targetResolver ?? new FrozenTargetResolver();
  const planning = new DirectCommandPlanningPipeline({
    contextBuilder,
    planner: options.planner ?? new HttpDirectCommandPlannerProvider(),
    resolver,
    disambiguator: options.disambiguator
      ?? new HttpDirectTargetDisambiguatorProvider(),
    ...(options.recovery === undefined
      ? {}
      : {
          recovery: new GroundedTargetRecovery({
            provider: options.recovery,
            resolver,
          }),
        }),
    ...(options.speechRefiner === undefined
      ? {}
      : { speechRefiner: new BoundedSpeechRefiner(options.speechRefiner) }),
    clock: options.clock,
    getCurrentSceneRevision: options.getCurrentSceneRevision,
  });
  const history = new DirectCommandHistoryContext({
    now: () => Number(options.clock.now()),
  });
  const spatialCapabilities = new InMemorySpatialCommandCapabilityRegistry();
  spatialCapabilities.register(new TextSpatialCreateCapability());
  const executor = new EditorDirectCommandExecutor({
    editorEngine: options.editorEngine,
    navigation: createDocumentSessionDirectCommandNavigationPort({
      getCurrentPage: options.getCurrentPage,
      goToPage: options.goToPage,
    }),
    getCurrentSceneRevision: options.getCurrentSceneRevision,
    clock: options.clock,
    spatialCapabilities,
  });
  const traces = new DirectCommandTraceStore();
  const route = new DirectCommandRoute({
    planning,
    executor,
    history,
    clock: options.clock,
    diagnostics: traces,
    ...(options.spatial === undefined
      ? {}
      : {
          spatial: createSpatialExecutionPipeline(
            options,
            options.spatial,
            executor,
            spatialCapabilities,
          ),
        }),
  });
  const noteAgentShadow = options.noteAgentShadow?.enabled === true
    ? createNoteAgentShadowRoute({
        options,
        contextBuilder,
        history,
        capabilities: spatialCapabilities,
        provider: options.noteAgentShadow.provider,
      })
    : undefined;

  let disposed = false;
  return {
    route,
    traces,
    ...(noteAgentShadow === undefined ? {} : { noteAgentShadow }),
    dispose() {
      if (disposed) return;
      disposed = true;
      route.dispose();
      recentOperations.dispose();
      traces.clear();
      noteAgentShadow?.traces.clear();
    },
  };
}

interface CreateNoteAgentShadowRouteInput {
  readonly options: EditorDirectCommandCompositionOptions;
  readonly contextBuilder: DirectCommandContextBuilder;
  readonly history: DirectCommandHistoryContext;
  readonly capabilities: InMemorySpatialCommandCapabilityRegistry;
  readonly provider: NoteDecisionProvider;
}

function createNoteAgentShadowRoute(
  input: CreateNoteAgentShadowRouteInput,
): NoteAgentShadowRoute {
  const readSnapshot = input.options.readCurrentGroundingSnapshot;
  const frozenSource = new CurrentRevisionSceneSnapshotSource(readSnapshot);
  const ledger = new DirectCommandOperationLedgerAdapter({
    records: input.history,
    resolveOutputObject: (record) => {
      const annotationId = record.editorAnnotationId;
      if (annotationId === undefined) return undefined;
      const scene = readSnapshot()?.scene;
      const object = scene?.objects.find((candidate) =>
        candidate.sourceObjectId === annotationId);
      return object === undefined
        ? undefined
        : { objectId: object.id, pageId: object.pageId };
    },
  });
  const world = new ExistingUnifiedObjectWorld({
    snapshotSource: new ExistingSceneUnifiedObjectWorldSource(frozenSource),
    operationLedger: ledger,
  });
  const resolver = new ExistingWorldResolver({ world });
  const placement = new ExistingPlacementEngine({ world, resolver });
  const registry = createExistingNoteToolRegistry();
  const spatialSceneSource = new ExistingSceneSpatialSceneSource({
    sceneSource: {
      getSnapshot: (reference) => {
        const snapshot = frozenSource.getSnapshot(reference);
        return snapshot === undefined ? undefined : { scene: snapshot.scene };
      },
    },
  });

  return new NoteAgentShadowRoute({
    contextBuilder: input.contextBuilder,
    history: input.history,
    world,
    registry,
    provider: input.provider,
    now: () => Number(input.options.clock.now()),
    createToolContext: (frozenWorld, turnId): NoteToolContext => ({
      mode: "SHADOW",
      turnId,
      frozenWorld,
      world,
      resolver,
      placement,
      getCurrentSceneRevision: input.options.getCurrentSceneRevision,
      preparePlacement: async (toolId, toolInput) => {
        if (toolId !== "text.create" || !hasText(toolInput)) return undefined;
        const command = {
          capability: "text" as const,
          operation: "create" as const,
          target: { kind: "CURRENT_PAGE" as const },
          payload: { text: toolInput.text },
        };
        const profile = input.capabilities.getProfile({
          capability: "text",
          operation: "create",
          command,
        });
        if (profile.status !== "SUPPORTED") return undefined;
        const scene = readSnapshot()?.scene;
        if (scene === undefined) return undefined;
        const reference = spatialReferenceForShadow(frozenWorld, scene);
        if (reference === undefined) return undefined;
        const spatialSnapshot = spatialSceneSource.getSnapshot(reference);
        if (spatialSnapshot.status !== "READY") return undefined;
        const measured = await input.capabilities.measure({
          kind: "NEW_DRAFT",
          draftKey: `note-shadow:${turnId}:${toolId}`,
          capability: "text",
          command,
          profile: profile.profile,
        });
        return measured.status !== "MEASURED"
          ? undefined
          : {
              snapshot: spatialSnapshot.snapshot,
              draft: measured.draft,
              profile: profile.profile,
            };
      },
    }),
  });
}

function spatialReferenceForShadow(
  frozenWorld: FrozenWorldContext,
  scene: FrozenPageGroundingSnapshot["scene"],
) {
  if (
    scene.page.id !== frozenWorld.pageId
    || scene.sceneRevision !== frozenWorld.sceneRevision
    || scene.page.width <= 0
    || scene.page.height <= 0
  ) return undefined;
  const frozen = frozenWorld.frozenVoiceContext;
  return {
    pageId: frozen.pageId,
    sceneRevision: frozen.sceneRevision,
    capturedAt: frozen.capturedAt,
    rotation: 0,
    viewportBounds: { x: 0, y: 0, width: scene.page.width, height: scene.page.height },
    focusStale: frozen.focusStale,
    ...(frozen.focusObjectId === undefined && frozen.focusBounds === undefined
      ? {}
      : {
          focus: {
            source: "VOICE_FROZEN_CONTEXT" as const,
            ...(frozen.focusObjectId === undefined ? {} : { objectId: frozen.focusObjectId }),
            ...(frozen.focusBounds === undefined ? {} : { bounds: frozen.focusBounds }),
          },
        }),
  };
}

function hasText(value: unknown): value is { readonly text: string } {
  return typeof value === "object" && value !== null
    && "text" in value && typeof value.text === "string";
}

function createSpatialExecutionPipeline(
  options: EditorDirectCommandCompositionOptions,
  spatial: EditorSpatialPlacementCompositionOptions,
  executor: EditorDirectCommandExecutor,
  capabilities: InMemorySpatialCommandCapabilityRegistry,
): SpatialPlacementExecutionPipeline {
  const readScene = () => options.readCurrentGroundingSnapshot()?.scene;
  const sceneSource = new ExistingSceneSpatialSceneSource({
    sceneSource: {
      getSnapshot: (reference) => {
        const scene = readScene();
        return scene?.page.id === reference.pageId
          && scene.sceneRevision === reference.sceneRevision
          ? { scene }
          : undefined;
      },
    },
  });
  const currentSceneSource = {
    getCurrentReference: () => {
      const scene = readScene();
      return scene === undefined
        ? undefined
        : {
            pageId: scene.page.id,
            sceneRevision: options.getCurrentSceneRevision(),
          };
    },
  };
  const observationBuilder = new MultimodalPlacementObservationBuilder({
    screenshotSource: new CanvasSpatialScreenshotSource({
      getBaseCanvas: spatial.getBaseCanvas,
      getOverlayCanvas: spatial.getOverlayCanvas,
      getCurrentPageId: () => readScene()?.page.id,
      getCurrentSceneRevision: options.getCurrentSceneRevision,
    }),
    imageProcessor: new BrowserSpatialObservationImageProcessor(),
    now: () => Number(options.clock.now()),
  });
  const multimodal = new BoundedMultimodalPlacementResolver({
    observationBuilder,
    ...(spatial.placementJudge === undefined
      ? {}
      : { provider: spatial.placementJudge }),
    currentSceneSource,
    now: () => Number(options.clock.now()),
  });
  const renderers = new InMemorySpatialPreviewRendererRegistry();
  renderers.register("text", new CanvasAnnotationSpatialPreviewRenderer({
    id: "native-canvas:text.create",
    createAnnotationInput: (input, bounds) =>
      capabilities.get(input.draft.capability, "create")
        ?.createPreviewAnnotationInput(input, bounds),
    mountCanvas: spatial.mountPreviewCanvas,
  }));
  const preview = new PreviewValidationOrchestrator({
    renderers,
    currentSceneSource,
    now: () => Number(options.clock.now()),
  });
  return new SpatialPlacementExecutionPipeline({
    sceneSource,
    createSceneReference: (ready) => createSpatialSceneReference(ready, readScene()),
    profiles: capabilities,
    measurements: capabilities,
    multimodal,
    preview,
    executor,
    now: () => Number(options.clock.now()),
  });
}

function createSpatialSceneReference(
  ready: ReadyForDirectCommandExecution,
  scene: FrozenPageGroundingSnapshot["scene"] | undefined,
) {
  const frozen = ready.context.frozenContext;
  if (
    scene === undefined
    || scene.page.id !== frozen.pageId
    || scene.sceneRevision !== frozen.sceneRevision
    || scene.page.width <= 0
    || scene.page.height <= 0
  ) {
    return undefined;
  }
  const pageBounds = {
    x: 0,
    y: 0,
    width: scene.page.width,
    height: scene.page.height,
  };
  return {
    pageId: frozen.pageId,
    sceneRevision: frozen.sceneRevision,
    capturedAt: frozen.capturedAt,
    rotation: 0,
    viewportBounds: pageBounds,
    focusStale: frozen.focusStale,
    ...(frozen.focusObjectId === undefined && frozen.focusBounds === undefined
      ? {}
      : {
          focus: {
            source: "VOICE_FROZEN_CONTEXT" as const,
            ...(frozen.focusObjectId === undefined
              ? {}
              : { objectId: frozen.focusObjectId }),
            ...(frozen.focusBounds === undefined
              ? {}
              : { bounds: frozen.focusBounds }),
          },
        }),
  };
}

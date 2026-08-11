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
}

export interface EditorDirectCommandComposition {
  route: DirectCommandRoute;
  traces: DirectCommandTraceStore;
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

  let disposed = false;
  return {
    route,
    traces,
    dispose() {
      if (disposed) return;
      disposed = true;
      route.dispose();
      recentOperations.dispose();
      traces.clear();
    },
  };
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

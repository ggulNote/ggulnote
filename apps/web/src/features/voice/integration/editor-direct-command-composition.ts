import type { EditorEngine } from "@ggulnote/editor-core";
import type { InteractionClock } from "@ggulnote/interaction-core";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
  DirectCommandPlanningPipeline,
  DirectCommandRoute,
  DirectCommandTraceStore,
  FrozenTargetResolver,
} from "../application";
import type { FrozenPageGroundingSnapshot } from "../domain";
import {
  HttpDirectCommandPlannerProvider,
  HttpDirectTargetDisambiguatorProvider,
  type DirectCommandPlannerProvider,
  type DirectTargetDisambiguatorProvider,
} from "../providers";
import {
  createDocumentSessionDirectCommandNavigationPort,
  EditorDirectCommandExecutor,
} from "./editor-direct-command-executor";
import { EditorDirectRecentOperationsSource } from "./editor-direct-recent-operations-source";

export interface EditorDirectCommandCompositionOptions {
  editorEngine: EditorEngine;
  clock: Pick<InteractionClock, "now">;
  readCurrentGroundingSnapshot(): FrozenPageGroundingSnapshot | undefined;
  getCurrentSceneRevision(): number;
  getCurrentPage(): number;
  goToPage(page: number): void;
  planner?: DirectCommandPlannerProvider;
  disambiguator?: DirectTargetDisambiguatorProvider;
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
  const planning = new DirectCommandPlanningPipeline({
    contextBuilder,
    planner: options.planner ?? new HttpDirectCommandPlannerProvider(),
    resolver: new FrozenTargetResolver(),
    disambiguator: options.disambiguator
      ?? new HttpDirectTargetDisambiguatorProvider(),
    clock: options.clock,
    getCurrentSceneRevision: options.getCurrentSceneRevision,
  });
  const history = new DirectCommandHistoryContext({
    now: () => Number(options.clock.now()),
  });
  const executor = new EditorDirectCommandExecutor({
    editorEngine: options.editorEngine,
    navigation: createDocumentSessionDirectCommandNavigationPort({
      getCurrentPage: options.getCurrentPage,
      goToPage: options.goToPage,
    }),
    getCurrentSceneRevision: options.getCurrentSceneRevision,
    clock: options.clock,
  });
  const traces = new DirectCommandTraceStore();
  const route = new DirectCommandRoute({
    planning,
    executor,
    history,
    clock: options.clock,
    diagnostics: traces,
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

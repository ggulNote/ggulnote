import {
  EditorEngine,
  type EditorPersistenceEvent,
  type SerializedAnnotation,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";
import type {
  CommandRelation,
  CompletedVoiceTurn,
  DirectCommandHistorySnapshot,
  DirectCommandPlanningResult,
  DirectEditorCommand,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
} from "../domain";
import {
  EditorDirectCommandExecutor,
  type DirectCommandNavigationPort,
} from "../integration/editor-direct-command-executor";
import { editorAnnotationSceneId } from "../integration/editor-voice-context";
import { DirectCommandExecutionRegistry } from "./direct-command-execution-registry";
import { DirectCommandHistoryContext } from "./direct-command-history-context";
import {
  DirectCommandRoute,
  type DirectCommandPlanningPort,
} from "./direct-command-route";
import type { DirectCommandPlanningOptions } from "./direct-command-planning-pipeline";

const PAGE_ID = "doc-1-page-1";
const PAGE_SIZE = { width: 1_000, height: 1_000 };

function turn(
  id: string,
  sceneRevision: number,
  pageId = PAGE_ID,
): CompletedVoiceTurn {
  return {
    id,
    providerId: "fake-speech",
    providerSessionId: "speech-" + id,
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript: id,
    finalSegments: [{ id: "segment-" + id, index: 0, text: id }],
    frozenContext: {
      pageId,
      sceneMode: "pdf",
      sceneRevision,
      focusObjectId: "pdf:line:stable",
      focusBounds: { x: 100, y: 200, width: 300, height: 20 },
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "selection",
      capturedAt: 2,
      pageId,
      sceneRevision,
      objectId: "pdf:line:stable",
      bounds: { x: 100, y: 200, width: 300, height: 20 },
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: sceneRevision,
      pageIdAtSpeechStart: pageId,
      currentSceneRevisionAtCompletion: sceneRevision,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: {
      interimUpdateCount: 0,
      finalSegmentCount: 1,
      providerRestartCount: 0,
    },
  };
}

function pdfTarget(
  voiceTurn: CompletedVoiceTurn,
  candidateId = "candidate-pdf-stable",
): ResolvedTarget {
  return {
    kind: "text_span",
    candidateId,
    pageId: voiceTurn.frozenContext.pageId,
    sceneRevision: voiceTurn.frozenContext.sceneRevision,
    source: "pdf",
    type: "line",
    objectId: "pdf:line:stable",
    text: "AI의 문제점을 설명하는 문장",
    bounds: [{ x: 100, y: 200, width: 300, height: 20 }],
    editable: false,
    annotatable: true,
  };
}

function editableTarget(
  voiceTurn: CompletedVoiceTurn,
  annotation: SerializedAnnotation,
): ResolvedTarget {
  return {
    kind: "text_span",
    candidateId: "candidate-text-" + annotation.id,
    pageId: voiceTurn.frozenContext.pageId,
    sceneRevision: voiceTurn.frozenContext.sceneRevision,
    source: "ggulnote",
    type: "text",
    objectId: editorAnnotationSceneId(annotation),
    text: String(annotation.properties.text ?? ""),
    bounds: [{ x: 100, y: 300, width: 200, height: 80 }],
    editable: true,
    annotatable: true,
  };
}

function ready(
  voiceTurn: CompletedVoiceTurn,
  relation: CommandRelation,
  command: DirectEditorCommand,
  target?: ResolvedTarget,
): ReadyForDirectCommandExecution {
  const candidates = target === undefined
    ? []
    : [{
        candidateId: target.candidateId,
        source: target.source,
        type: target.type,
        pageId: target.pageId,
        ...(target.objectId === undefined
          ? {}
          : { sceneObjectId: target.objectId }),
        ...(target.kind === "text_span" ? { text: target.text } : {}),
        ...(target.kind === "object" && target.bounds !== undefined
          ? { bounds: target.bounds }
          : target.kind === "text_span" && target.bounds?.[0] !== undefined
            ? { bounds: target.bounds[0] }
            : {}),
        editable: target.editable,
        annotatable: target.annotatable,
      }];
  return {
    status: "READY_FOR_EXECUTION",
    turnId: voiceTurn.id,
    context: {
      turn: voiceTurn,
      frozenContext: voiceTurn.frozenContext,
      pageTargetCatalog: {
        pageId: voiceTurn.frozenContext.pageId,
        sceneRevision: voiceTurn.frozenContext.sceneRevision,
        candidates,
      },
      recentOperations: [],
      plannerContext: {
        turn: {
          turnId: voiceTurn.id,
          language: voiceTurn.language,
          rawFinalTranscript: voiceTurn.rawTranscript,
        },
        frozenContext: {
          pageId: voiceTurn.frozenContext.pageId,
          sceneMode: voiceTurn.frozenContext.sceneMode,
          sceneRevision: voiceTurn.frozenContext.sceneRevision,
          focusSource: voiceTurn.frozenContext.focusSource,
          focusStale: false,
          capturedAt: voiceTurn.frozenContext.capturedAt,
          focus: null,
        },
        allowedCommands: [
          "annotation.underline",
          "annotation.highlight",
          "navigation.next_page",
          "navigation.previous_page",
          "history.undo",
          "text.replace_content",
        ],
      },
    },
    plan: {
      status: "EXECUTABLE",
      planId: "plan-" + voiceTurn.id,
      turnId: voiceTurn.id,
      sceneRevision: voiceTurn.frozenContext.sceneRevision,
      normalizedIntent: voiceTurn.rawTranscript,
      relation: relation === "CANCEL" ? "NEW" : relation,
      command,
    },
    ...(target === undefined ? {} : { target }),
    disambiguationUsed: false,
    timestamps: { routeReceivedAt: 1, validatedAt: 2 },
  };
}

type PlanningStep =
  | DirectCommandPlanningResult
  | ((
      voiceTurn: CompletedVoiceTurn,
      options: DirectCommandPlanningOptions | undefined,
    ) => Promise<DirectCommandPlanningResult> | DirectCommandPlanningResult);

class SequencePlanningPort implements DirectCommandPlanningPort {
  public readonly calls: Array<{
    turnId: string;
    historySnapshot?: DirectCommandHistorySnapshot;
  }> = [];

  public constructor(private readonly steps: PlanningStep[]) {}

  public async plan(
    voiceTurn: CompletedVoiceTurn,
    options?: DirectCommandPlanningOptions,
  ): Promise<DirectCommandPlanningResult> {
    this.calls.push({
      turnId: voiceTurn.id,
      ...(options?.historySnapshot === undefined
        ? {}
        : { historySnapshot: options.historySnapshot }),
    });
    const step = this.steps.shift();
    if (step === undefined) throw new Error("No planning step.");
    return typeof step === "function"
      ? step(voiceTurn, options)
      : step;
  }
}

class FakeNavigation implements DirectCommandNavigationPort {
  public currentPage = 1;
  public getCurrentPage(): number {
    return this.currentPage;
  }
  public goToPage(page: number): void {
    this.currentPage = Math.max(1, page);
  }
}

function createHarness(
  steps: PlanningStep[],
  registry = new DirectCommandExecutionRegistry(),
) {
  let annotationSequence = 0;
  let currentRevision = 7;
  const editor = new EditorEngine({
    idGenerator: () => "ann-" + String(++annotationSequence),
  });
  editor.setDocument("doc-1");
  editor.setActivePage(PAGE_ID, PAGE_SIZE);
  const planning = new SequencePlanningPort(steps);
  const history = new DirectCommandHistoryContext({ now: () => 100 });
  const executor = new EditorDirectCommandExecutor({
    editorEngine: editor,
    navigation: new FakeNavigation(),
    getCurrentSceneRevision: () => currentRevision,
    clock: { now: () => toSessionTimeMs(100) },
  });
  const route = new DirectCommandRoute({
    planning,
    executor,
    history,
    registry,
    clock: { now: () => toSessionTimeMs(100) },
  });
  return {
    editor,
    planning,
    history,
    registry,
    route,
    setRevision(value: number) {
      currentRevision = value;
    },
  };
}

function collectOperations(editor: EditorEngine) {
  const events: EditorPersistenceEvent[] = [];
  const dispose = editor.subscribeToOperations((event) => events.push(event));
  return { events, dispose };
}

function terminal(
  status: Exclude<
    DirectCommandPlanningResult["status"],
    "READY_FOR_EXECUTION" | "ERROR"
  >,
  voiceTurn: CompletedVoiceTurn,
): DirectCommandPlanningResult {
  return {
    status,
    turnId: voiceTurn.id,
    timestamps: { routeReceivedAt: 1 },
  };
}

function highlightCommand(
  relation: "focused" | "last_target",
  color: string,
): DirectEditorCommand {
  return {
    capability: "annotation",
    operation: "highlight",
    target: { kind: "relative", relation },
    payload: { color },
  };
}

function underlineCommand(
  relation: "focused" | "last_target",
): DirectEditorCommand {
  return {
    capability: "annotation",
    operation: "underline",
    target: { kind: "relative", relation },
    payload: {},
  };
}

describe("DirectCommandRoute Phase E", () => {
  it("E1 revises a highlight color on the same annotation and undo restores yellow", async () => {
    const first = turn("turn-highlight-yellow", 7);
    const second = turn("turn-highlight-blue", 8);
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(second, "REVISE_LAST", highlightCommand("last_target", "blue"), pdfTarget(second)),
    ]);
    const log = collectOperations(harness.editor);

    const created = await harness.route.execute(first);
    harness.setRevision(8);
    const revised = await harness.route.execute(second);

    expect(created).toMatchObject({ status: "COMMITTED" });
    expect(revised).toMatchObject({ status: "REVISED" });
    const annotations = harness.editor.exportPageSnapshot(PAGE_ID).annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      type: "HIGHLIGHT",
      properties: { color: "blue" },
    });
    expect(log.events.map((event) => event.operation.type))
      .toEqual(["CREATE_ANNOTATION", "UPDATE_ANNOTATION"]);

    harness.editor.undo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.color).toBe("yellow");
    log.dispose();
  });

  it("E2 revises editable text and one undo restores the previous replacement", async () => {
    const first = turn("turn-text-hello", 7);
    const second = turn("turn-text-hi", 8);
    const harness = createHarness([]);
    harness.editor.createAnnotation({
      type: "TEXT",
      pageId: PAGE_ID,
      bounds: { x: 0.1, y: 0.3, width: 0.2, height: 0.08 },
      text: "old",
    });
    const annotation = harness.editor.exportPageSnapshot(PAGE_ID).annotations[0];
    if (annotation === undefined) throw new Error("Expected text annotation.");
    const firstTarget = editableTarget(first, annotation);
    const secondTarget = editableTarget(second, {
      ...annotation,
      properties: { ...annotation.properties, text: "Hello" },
    });
    const planning = new SequencePlanningPort([
      ready(first, "NEW", {
        capability: "text",
        operation: "replace_content",
        target: { kind: "relative", relation: "focused" },
        payload: { text: "Hello" },
      }, firstTarget),
      ready(second, "REVISE_LAST", {
        capability: "text",
        operation: "replace_content",
        target: { kind: "relative", relation: "last_target" },
        payload: { text: "Hi" },
      }, secondTarget),
    ]);
    let currentRevision = first.frozenContext.sceneRevision;
    const route = new DirectCommandRoute({
      planning,
      executor: new EditorDirectCommandExecutor({
        editorEngine: harness.editor,
        navigation: new FakeNavigation(),
        getCurrentSceneRevision: () => currentRevision,
        clock: { now: () => toSessionTimeMs(100) },
      }),
      history: harness.history,
      clock: { now: () => toSessionTimeMs(100) },
    });

    await route.execute(first);
    currentRevision = second.frozenContext.sceneRevision;
    await route.execute(second);
    expect(harness.editor.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.text).toBe("Hi");
    harness.editor.undo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.text).toBe("Hello");
  });

  it("E3/E4 rejects revise without a usable previous operation or with a changed target", async () => {
    const noPrevious = turn("turn-revise-empty", 7);
    const harness = createHarness([
      ready(
        noPrevious,
        "REVISE_LAST",
        highlightCommand("last_target", "blue"),
        pdfTarget(noPrevious),
      ),
    ]);
    await expect(harness.route.execute(noPrevious)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "REVISE_NOT_AVAILABLE",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);

    const first = turn("turn-revise-source", 7);
    const second = turn("turn-revise-invalid", 8);
    const changed = pdfTarget(second, "candidate-pdf-different");
    const changedHarness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(
        second,
        "REVISE_LAST",
        highlightCommand("last_target", "blue"),
        changed,
      ),
    ]);
    await changedHarness.route.execute(first);
    changedHarness.setRevision(8);
    await expect(changedHarness.route.execute(second)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "INVALID_TARGET",
    });
    expect(changedHarness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(1);
  });

  it("E5/E6 CONTINUE adds one operation to the same target and requires history", async () => {
    const first = turn("turn-continue-highlight", 7);
    const second = turn("turn-continue-underline", 8);
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(second, "CONTINUE", underlineCommand("last_target"), pdfTarget(second)),
    ]);
    await harness.route.execute(first);
    harness.setRevision(8);
    await expect(harness.route.execute(second)).resolves.toMatchObject({
      status: "COMMITTED",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(2);
    harness.editor.undo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toMatchObject([{ type: "HIGHLIGHT" }]);

    const empty = turn("turn-continue-empty", 7);
    const emptyHarness = createHarness([
      ready(empty, "CONTINUE", underlineCommand("last_target"), pdfTarget(empty)),
    ]);
    await expect(emptyHarness.route.execute(empty)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "TARGET_NOT_FOUND",
    });
    expect(emptyHarness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(0);
  });

  it("E7 refuses silent last-target reuse across pages", async () => {
    const first = turn("turn-page-one", 7);
    const second = turn("turn-page-two", 8, "doc-1-page-2");
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(second, "CONTINUE", underlineCommand("last_target"), pdfTarget(second)),
    ]);
    await harness.route.execute(first);
    harness.setRevision(8);
    await expect(harness.route.execute(second)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "INVALID_TARGET",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(1);
  });

  it("navigation updates last operation without replacing the reusable target", async () => {
    const first = turn("turn-navigation-source", 7);
    const navigation = turn("turn-navigation", 8);
    const revise = turn("turn-navigation-revise", 8);
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(navigation, "NEW", {
        capability: "navigation",
        operation: "next_page",
        target: { kind: "CURRENT_PAGE" },
        payload: {},
      }),
      ready(
        revise,
        "REVISE_LAST",
        highlightCommand("last_target", "blue"),
        pdfTarget(revise),
      ),
    ]);
    await harness.route.execute(first);
    harness.setRevision(8);
    await expect(harness.route.execute(navigation)).resolves.toMatchObject({
      status: "NAVIGATED",
    });
    expect(harness.route.getLastOperation()?.command.capability)
      .toBe("navigation");
    expect(harness.route.getLastReusableTarget()).toMatchObject({
      candidateId: "candidate-pdf-stable",
    });
    await expect(harness.route.execute(revise)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "REVISE_NOT_AVAILABLE",
    });
  });

  it.each([
    { name: "DEFER_SPATIAL", status: "DEFERRED_SPATIAL" as const },
    { name: "AMBIGUOUS", status: "TARGET_AMBIGUOUS" as const },
    { name: "PLANNER_ERROR", status: "ERROR" as const },
  ])("E8-E10 keeps last target through $name", async ({ status }) => {
    const first = turn("turn-pollution-first-" + status, 7);
    const middle = turn("turn-pollution-middle-" + status, 8);
    const last = turn("turn-pollution-last-" + status, 8);
    const middleResult: DirectCommandPlanningResult = status === "ERROR"
      ? {
          status: "ERROR",
          turnId: middle.id,
          errorCode: "PLANNER_TIMEOUT",
          timestamps: { routeReceivedAt: 1 },
        }
      : terminal(status, middle);
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      middleResult,
      ready(last, "CONTINUE", underlineCommand("last_target"), pdfTarget(last)),
    ]);

    await harness.route.execute(first);
    harness.setRevision(8);
    await harness.route.execute(middle);
    await harness.route.execute(last);

    expect(harness.planning.calls[2]?.historySnapshot?.lastReusableTarget)
      .toMatchObject({ candidateId: "candidate-pdf-stable" });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(2);
  });

  it("CANCEL is a consumed no-op and does not change history", async () => {
    const cancelled = turn("turn-cancelled", 7);
    const harness = createHarness([
      terminal("CANCELLED", cancelled),
    ]);
    await expect(harness.route.execute(cancelled)).resolves.toEqual({
      status: "CANCELLED",
      turnId: cancelled.id,
    });
    expect(harness.route.getLastOperation()).toBeNull();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(0);
  });

  it("E11 replays a completed duplicate without planning or mutation twice", async () => {
    const duplicate = turn("turn-duplicate-completed", 7);
    const harness = createHarness([
      ready(
        duplicate,
        "NEW",
        highlightCommand("focused", "yellow"),
        pdfTarget(duplicate),
      ),
    ]);
    const first = await harness.route.execute(duplicate);
    const second = await harness.route.execute(duplicate);

    expect(second).toEqual(first);
    expect(harness.planning.calls).toHaveLength(1);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(1);
  });

  it("E12 shares one in-flight execution between concurrent duplicates", async () => {
    const duplicate = turn("turn-duplicate-in-flight", 7);
    let release: ((result: DirectCommandPlanningResult) => void) | undefined;
    const pending = new Promise<DirectCommandPlanningResult>((resolve) => {
      release = resolve;
    });
    const harness = createHarness([
      () => pending,
    ]);

    const first = harness.route.execute(duplicate);
    const second = harness.route.execute(duplicate);
    release?.(ready(
      duplicate,
      "NEW",
      highlightCommand("focused", "yellow"),
      pdfTarget(duplicate),
    ));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "COMMITTED" }),
      expect.objectContaining({ status: "COMMITTED" }),
    ]);
    expect(harness.planning.calls).toHaveLength(1);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(1);
  });

  it("E13 executes different turn IDs independently", async () => {
    const first = turn("turn-independent-a", 7);
    const second = turn("turn-independent-b", 8);
    const harness = createHarness([
      ready(first, "NEW", highlightCommand("focused", "yellow"), pdfTarget(first)),
      ready(second, "NEW", underlineCommand("focused"), pdfTarget(second)),
    ]);
    await harness.route.execute(first);
    harness.setRevision(8);
    await harness.route.execute(second);
    expect(harness.planning.calls).toHaveLength(2);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(2);
  });

  it("E14/E15 retries transient planner failure and always clears in-flight state", async () => {
    const retry = turn("turn-retry", 7);
    const registry = new DirectCommandExecutionRegistry();
    const harness = createHarness([
      {
        status: "ERROR",
        turnId: retry.id,
        errorCode: "PLANNER_TIMEOUT",
        timestamps: { routeReceivedAt: 1 },
      },
      ready(
        retry,
        "NEW",
        highlightCommand("focused", "yellow"),
        pdfTarget(retry),
      ),
    ], registry);

    await expect(harness.route.execute(retry)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "PLANNER_TIMEOUT",
    });
    expect(registry.hasInFlight(retry.id)).toBe(false);
    expect(registry.hasCompleted(retry.id)).toBe(false);
    await expect(harness.route.execute(retry)).resolves.toMatchObject({
      status: "COMMITTED",
    });
    expect(harness.planning.calls).toHaveLength(2);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toHaveLength(1);
  });

  it("E16 records undo as last operation but preserves a valid PDF reusable target", async () => {
    const create = turn("turn-undo-create", 7);
    const undo = turn("turn-undo", 8);
    const revise = turn("turn-after-undo-revise", 9);
    const continueTurn = turn("turn-after-undo-continue", 9);
    const harness = createHarness([
      ready(create, "NEW", highlightCommand("focused", "yellow"), pdfTarget(create)),
      ready(undo, "NEW", {
        capability: "history",
        operation: "undo",
        target: { kind: "LAST_OPERATION" },
        payload: {},
      }),
      ready(
        revise,
        "REVISE_LAST",
        highlightCommand("last_target", "blue"),
        pdfTarget(revise),
      ),
      ready(
        continueTurn,
        "CONTINUE",
        underlineCommand("last_target"),
        pdfTarget(continueTurn),
      ),
    ]);
    await harness.route.execute(create);
    harness.setRevision(8);
    await harness.route.execute(undo);
    expect(harness.route.getLastOperation()?.command.capability).toBe("history");
    expect(harness.route.getLastReusableTarget()).not.toBeNull();

    harness.setRevision(9);
    await expect(harness.route.execute(revise)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "REVISE_NOT_AVAILABLE",
    });
    await expect(harness.route.execute(continueTurn)).resolves.toMatchObject({
      status: "COMMITTED",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations)
      .toMatchObject([{ type: "UNDERLINE" }]);
  });

  it("E17 rejects continuation after an editable target is deleted", async () => {
    const first = turn("turn-editable-first", 7);
    const second = turn("turn-editable-deleted", 8);
    const harness = createHarness([]);
    const annotationId = harness.editor.createAnnotation({
      type: "TEXT",
      pageId: PAGE_ID,
      bounds: { x: 0.1, y: 0.3, width: 0.2, height: 0.08 },
      text: "old",
    });
    const annotation = harness.editor.exportPageSnapshot(PAGE_ID).annotations[0];
    if (annotation === undefined) throw new Error("Expected text annotation.");
    const firstTarget = editableTarget(first, annotation);
    const secondTarget = editableTarget(second, annotation);
    const planning = new SequencePlanningPort([
      ready(first, "NEW", {
        capability: "text",
        operation: "replace_content",
        target: { kind: "relative", relation: "focused" },
        payload: { text: "Hello" },
      }, firstTarget),
      ready(second, "CONTINUE", {
        capability: "text",
        operation: "replace_content",
        target: { kind: "relative", relation: "last_target" },
        payload: { text: "again" },
      }, secondTarget),
    ]);
    let currentRevision = first.frozenContext.sceneRevision;
    const route = new DirectCommandRoute({
      planning,
      executor: new EditorDirectCommandExecutor({
        editorEngine: harness.editor,
        navigation: new FakeNavigation(),
        getCurrentSceneRevision: () => currentRevision,
        clock: { now: () => toSessionTimeMs(100) },
      }),
      history: harness.history,
      clock: { now: () => toSessionTimeMs(100) },
    });
    await route.execute(first);
    currentRevision = second.frozenContext.sceneRevision;
    harness.editor.select(annotationId);
    harness.editor.deleteSelected();

    await expect(route.execute(second)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "INVALID_TARGET",
    });
    expect(route.getLastOperation()?.turnId).toBe(first.id);
  });
});

describe("DirectCommandRoute Phase F lifecycle", () => {
  it("aborts an in-flight planner on dispose and ignores a late READY result", async () => {
    const voiceTurn = turn("turn-dispose", 7);
    let resolvePlanning:
      | ((result: DirectCommandPlanningResult) => void)
      | undefined;
    const latePlanning = new Promise<DirectCommandPlanningResult>((resolve) => {
      resolvePlanning = resolve;
    });
    const harness = createHarness([
      () => latePlanning,
    ]);
    const operations = collectOperations(harness.editor);

    const pending = harness.route.execute(voiceTurn);
    harness.route.dispose();
    resolvePlanning?.(
      ready(
        voiceTurn,
        "NEW",
        underlineCommand("focused"),
        pdfTarget(voiceTurn),
      ),
    );

    await expect(pending).resolves.toEqual({
      status: "ERROR",
      turnId: voiceTurn.id,
      errorCode: "ABORTED",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(operations.events).toHaveLength(0);
    operations.dispose();
  });
});

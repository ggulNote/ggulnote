import {
  EditorEngine,
  buildSceneSnapshot,
  type EditorPersistenceEvent,
  type PdfSceneObject,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import {
  VoiceTurnController,
} from "../application";
import { FakeVoiceTurnContextSource } from "../application/testing/fake-voice-turn-context-source";
import { FakeDirectCommandPlannerProvider } from "../providers/testing/fake-direct-command-planner-provider";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import { DirectCommandVoiceTurnBridge } from "./direct-command-voice-turn-bridge";
import { createEditorDirectCommandComposition } from "./editor-direct-command-composition";

const PAGE_ID = "doc-1-page-1";
const LINE: PdfSceneObject = {
  id: "pdf:doc-1:0:line:focus",
  pageId: PAGE_ID,
  source: "pdf",
  kind: "line",
  bounds: { x: 100, y: 200, width: 300, height: 20 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "line-focus",
  text: "AI 시스템은 학습 데이터의 편향을 재생산할 수 있다.",
  readingOrder: 1,
  childWordIds: [],
  paragraphId: null,
};

describe("production Voice Turn to Direct Command flow", () => {
  it("automatically commits one focused PDF underline after one completed turn", async () => {
    let now = 0;
    const clock = { now: () => toSessionTimeMs(now) };
    const editor = new EditorEngine({ idGenerator: () => "voice-underline-1" });
    editor.setDocument("doc-1");
    editor.setActivePage(PAGE_ID, { width: 600, height: 800 });
    const scene = buildSceneSnapshot({
      mode: "pdf",
      page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
      sceneRevision: 7,
      pdfObjects: [LINE],
    });
    const sourceBefore = JSON.stringify(scene.objects);
    const planner = new FakeDirectCommandPlannerProvider({
      result: {
        status: "EXECUTABLE",
        planId: "plan-production-underline",
        turnId: "turn-1",
        sceneRevision: 7,
        normalizedIntent: "여기 밑줄 쳐줘",
        relation: "NEW",
        command: {
          capability: "annotation",
          operation: "underline",
          target: { kind: "relative", relation: "focused" },
          payload: {},
        },
      },
    });
    const direct = createEditorDirectCommandComposition({
      editorEngine: editor,
      clock,
      readCurrentGroundingSnapshot: () => ({ scene }),
      getCurrentSceneRevision: () => 7,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      planner,
    });
    const speech = new FakeSpeechRecognitionProvider({ clock });
    const context = new FakeVoiceTurnContextSource({
      frozenContext: {
        pageId: PAGE_ID,
        sceneMode: "pdf",
        sceneRevision: 7,
        focusObjectId: LINE.id,
        focusBounds: { ...LINE.bounds },
        focusSource: "selection",
        focusStale: false,
        capturedAt: 1,
      },
      focusSnapshot: {
        source: "selection",
        capturedAt: 1,
        pageId: PAGE_ID,
        sceneRevision: 7,
        objectId: LINE.id,
        bounds: { ...LINE.bounds },
        stale: false,
      },
    });
    const voice = new VoiceTurnController({
      provider: speech,
      contextSource: context,
      clock,
      createTurnId: () => "turn-1",
    });
    const bridge = new DirectCommandVoiceTurnBridge({
      controller: voice,
      route: direct.route,
    });
    const operations: EditorPersistenceEvent[] = [];
    const unsubscribe = editor.subscribeToOperations((event) => {
      operations.push(event);
    });

    await voice.start();
    speech.emitSpeechStart({ at: 1 });
    for (let index = 0; index < 10; index += 1) {
      speech.emitInterim(0, "여기 밑줄".slice(0, index + 1), {
        at: 2 + index,
      });
    }
    speech.emitFinal(0, "여기 밑줄 쳐줘", { at: 20 });
    now = 21;
    speech.emitProviderEnd({ at: 21 });

    await vi.waitFor(() => {
      expect(editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(1);
    });

    expect(planner.planCallCount).toBe(1);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      historyAction: "execute",
      operation: { type: "CREATE_ANNOTATION" },
    });
    expect(editor.exportPageSnapshot(PAGE_ID).annotations[0]).toMatchObject({
      id: "voice-underline-1",
      type: "UNDERLINE",
    });
    expect(JSON.stringify(scene.objects)).toBe(sourceBefore);
    expect(JSON.stringify(planner.lastInput)).not.toContain(LINE.id);
    expect(direct.traces.getSnapshot()).toHaveLength(1);
    expect(direct.traces.getSnapshot()[0]).toMatchObject({
      turnId: "turn-1",
      planId: "plan-production-underline",
      plannerStatus: "EXECUTABLE",
      command: {
        capability: "annotation",
        operation: "underline",
        relation: "NEW",
      },
      targetQueryKind: "relative",
      resolutionStatus: "RESOLVED",
      resolvedTargetKind: "text_span",
      guardStatus: "PASSED",
      executionStatus: "COMMITTED",
      metrics: {
        plannerMs: expect.any(Number),
        resolverMs: expect.any(Number),
        validationMs: expect.any(Number),
        compileMs: expect.any(Number),
        commitMs: expect.any(Number),
        directRouteMs: expect.any(Number),
        voiceEndToCommitMs: expect.any(Number),
      },
    });

    unsubscribe();
    bridge.dispose();
    direct.dispose();
    voice.dispose();
  });
});

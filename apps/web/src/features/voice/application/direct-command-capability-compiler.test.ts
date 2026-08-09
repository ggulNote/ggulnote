import { describe, expect, it } from "vitest";
import type {
  CompletedVoiceTurn,
  DirectCommandContext,
  DirectEditorCommand,
  ExecutableCommandRelation,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
} from "../domain";
import { compileDirectCommandCapability } from "./direct-command-capability-compiler";

const TURN: CompletedVoiceTurn = {
  id: "turn-phase-d",
  providerId: "fake-speech",
  providerSessionId: "speech-phase-d",
  language: "ko-KR",
  requestedAt: 1,
  startedAt: 2,
  completedAt: 3,
  state: "completed",
  rawTranscript: "여기 밑줄",
  finalSegments: [{ id: "segment-1", index: 0, text: "여기 밑줄" }],
  frozenContext: {
    pageId: "doc-1-page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusObjectId: "pdf:line:1",
    focusBounds: { x: 100, y: 200, width: 300, height: 20 },
    focusSource: "selection",
    focusStale: false,
    capturedAt: 2,
  },
  focusSnapshot: {
    source: "selection",
    capturedAt: 2,
    pageId: "doc-1-page-1",
    sceneRevision: 7,
    objectId: "pdf:line:1",
    bounds: { x: 100, y: 200, width: 300, height: 20 },
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 7,
    pageIdAtSpeechStart: "doc-1-page-1",
    currentSceneRevisionAtCompletion: 7,
    sceneChangedDuringTurn: false,
    pageChangedDuringTurn: false,
  },
  metrics: {
    interimUpdateCount: 0,
    finalSegmentCount: 1,
    providerRestartCount: 0,
  },
};

const CONTEXT: DirectCommandContext = {
  turn: TURN,
  frozenContext: TURN.frozenContext,
  pageTargetCatalog: {
    pageId: "doc-1-page-1",
    sceneRevision: 7,
    candidates: [
      {
        candidateId: "candidate-pdf",
        source: "pdf",
        type: "line",
        pageId: "doc-1-page-1",
        sceneObjectId: "pdf:line:1",
        text: "PDF source text",
        bounds: { x: 100, y: 200, width: 300, height: 20 },
        editable: false,
        annotatable: true,
      },
      {
        candidateId: "candidate-text",
        source: "ggulnote",
        type: "text",
        pageId: "doc-1-page-1",
        sceneObjectId: "canvas:doc-1-page-1:text:ann-1",
        text: "old",
        bounds: { x: 100, y: 300, width: 200, height: 80 },
        editable: true,
        annotatable: true,
      },
    ],
  },
  recentOperations: [],
  plannerContext: {
    turn: {
      turnId: TURN.id,
      language: TURN.language,
      rawFinalTranscript: TURN.rawTranscript,
    },
    frozenContext: {
      pageId: "doc-1-page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
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
};

const PDF_TEXT: ResolvedTarget = {
  kind: "text_span",
  candidateId: "candidate-pdf",
  pageId: "doc-1-page-1",
  sceneRevision: 7,
  source: "pdf",
  type: "line",
  objectId: "pdf:line:1",
  text: "PDF source text",
  bounds: [{ x: 100, y: 200, width: 300, height: 20 }],
  editable: false,
  annotatable: true,
};

const EDITABLE_TEXT: ResolvedTarget = {
  kind: "text_span",
  candidateId: "candidate-text",
  pageId: "doc-1-page-1",
  sceneRevision: 7,
  source: "ggulnote",
  type: "text",
  objectId: "canvas:doc-1-page-1:text:ann-1",
  text: "old",
  bounds: [{ x: 100, y: 300, width: 200, height: 80 }],
  editable: true,
  annotatable: true,
};

function ready(
  command: DirectEditorCommand,
  target?: ResolvedTarget,
  relation: ExecutableCommandRelation = "NEW",
): ReadyForDirectCommandExecution {
  return {
    status: "READY_FOR_EXECUTION",
    turnId: TURN.id,
    context: CONTEXT,
    plan: {
      status: "EXECUTABLE",
      planId: "plan-phase-d",
      turnId: TURN.id,
      sceneRevision: 7,
      normalizedIntent: "테스트 명령",
      relation,
      command,
    },
    ...(target === undefined ? {} : { target }),
    disambiguationUsed: false,
    timestamps: { routeReceivedAt: 1, validatedAt: 2 },
  };
}

const COMPILE_CONTEXT = {
  pageSize: { width: 1_000, height: 1_000 },
};

describe("compileDirectCommandCapability", () => {
  it("compiles PDF underline to the existing normalized annotation input", () => {
    const result = compileDirectCommandCapability(ready({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, PDF_TEXT), COMPILE_CONTEXT);

    expect(result).toEqual({
      status: "COMPILED",
      instruction: {
        kind: "CREATE_ANNOTATION",
        input: {
          type: "UNDERLINE",
          pageId: "doc-1-page-1",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
        },
      },
    });
  });

  it("passes explicit highlight color and leaves absent color to Editor defaults", () => {
    const explicit = compileDirectCommandCapability(ready({
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "focused" },
      payload: { color: "#facc15" },
    }, PDF_TEXT), COMPILE_CONTEXT);
    expect(explicit).toMatchObject({
      status: "COMPILED",
      instruction: {
        input: { type: "HIGHLIGHT", color: "#facc15" },
      },
    });

    const defaulted = compileDirectCommandCapability(ready({
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, PDF_TEXT), COMPILE_CONTEXT);
    expect(defaulted).toMatchObject({
      status: "COMPILED",
      instruction: { input: { type: "HIGHLIGHT" } },
    });
    if (defaulted.status === "COMPILED" && defaulted.instruction.kind === "CREATE_ANNOTATION") {
      expect(defaulted.instruction.input).not.toHaveProperty("color");
    }
  });

  it("compiles editable text replacement and rejects PDF replacement", () => {
    const command: DirectEditorCommand = {
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "new" },
    };
    expect(compileDirectCommandCapability(
      ready(command, EDITABLE_TEXT),
      COMPILE_CONTEXT,
    )).toEqual({
      status: "COMPILED",
      instruction: {
        kind: "REPLACE_TEXT_CONTENT",
        pageId: "doc-1-page-1",
        sceneObjectId: "canvas:doc-1-page-1:text:ann-1",
        text: "new",
      },
    });
    expect(compileDirectCommandCapability(
      ready(command, PDF_TEXT),
      COMPILE_CONTEXT,
    )).toEqual({
      status: "ERROR",
      errorCode: "TARGET_NOT_EDITABLE",
    });
  });

  it.each([
    ["next_page", "NAVIGATE"],
    ["previous_page", "NAVIGATE"],
  ] as const)("compiles navigation.%s", (operation, kind) => {
    expect(compileDirectCommandCapability(ready({
      capability: "navigation",
      operation,
      target: { kind: "CURRENT_PAGE" },
      payload: {},
    }), {})).toMatchObject({
      status: "COMPILED",
      instruction: { kind, direction: operation },
    });
  });

  it("compiles history.undo to the existing history instruction", () => {
    expect(compileDirectCommandCapability(ready({
      capability: "history",
      operation: "undo",
      target: { kind: "LAST_OPERATION" },
      payload: {},
    }), {})).toEqual({
      status: "COMPILED",
      instruction: { kind: "UNDO" },
    });
  });

  it("rejects multi-rect geometry instead of creating multiple undo units", () => {
    const target: ResolvedTarget = {
      ...PDF_TEXT,
      bounds: [
        { x: 100, y: 200, width: 300, height: 20 },
        { x: 100, y: 230, width: 200, height: 20 },
      ],
    };
    expect(compileDirectCommandCapability(ready({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, target), COMPILE_CONTEXT)).toEqual({
      status: "ERROR",
      errorCode: "COMPILE_FAILED",
    });
  });

  it("does not execute Phase E relations as NEW", () => {
    const command: DirectEditorCommand = {
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    };
    expect(compileDirectCommandCapability(
      ready(command, PDF_TEXT, "REVISE_LAST"),
      COMPILE_CONTEXT,
    )).toEqual({
      status: "ERROR",
      errorCode: "REVISE_NOT_AVAILABLE",
    });
    expect(compileDirectCommandCapability(
      ready(command, PDF_TEXT, "CONTINUE"),
      COMPILE_CONTEXT,
    )).toEqual({
      status: "ERROR",
      errorCode: "UNSUPPORTED_RELATION",
    });
  });
});

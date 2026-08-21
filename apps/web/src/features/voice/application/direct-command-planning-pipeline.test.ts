import {
  buildSceneSnapshot,
  type CanvasSceneObject,
  type PdfSceneObject,
} from "@ggulnote/editor-core";
import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import type {
  CompletedVoiceTurn,
  DirectEditorCommand,
  DirectPlannerResult,
} from "../domain";
import { FakeDirectCommandPlannerProvider } from "../providers/testing/fake-direct-command-planner-provider";
import { FakeDirectTargetDisambiguatorProvider } from "../providers/testing/fake-direct-target-disambiguator-provider";
import { FakeGroundedTargetRecoveryProvider } from "../providers/testing/fake-grounded-target-recovery-provider";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
} from "./direct-command-context-builder";
import { DirectCommandPlanningPipeline } from "./direct-command-planning-pipeline";
import { FrozenTargetResolver } from "./frozen-target-resolver";
import { GroundedTargetRecovery } from "./grounded-target-recovery";

const FOCUS_LINE: PdfSceneObject = {
  id: "pdf:line:focus",
  pageId: "page-1",
  source: "pdf",
  kind: "word",
  bounds: { x: 10, y: 20, width: 220, height: 18 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "focus",
  text: "세종대왕의 주요 업적",
  readingOrder: 1,
  lineId: "line-focus",
  charOffsetStart: 0,
  charOffsetEnd: 11,
};

const AMBIGUOUS_A: PdfSceneObject = {
  id: "pdf:line:ambiguous-a",
  pageId: "page-1",
  source: "pdf",
  kind: "line",
  bounds: { x: 10, y: 60, width: 220, height: 18 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "ambiguous-a",
  text: "동일한 AI 문제 문장",
  readingOrder: 2,
  childWordIds: [],
  paragraphId: null,
};

const AMBIGUOUS_B: PdfSceneObject = {
  ...AMBIGUOUS_A,
  id: "pdf:line:ambiguous-b",
  sourceObjectId: "ambiguous-b",
  readingOrder: 3,
  bounds: { x: 10, y: 90, width: 220, height: 18 },
};

const EDITABLE_TEXT: CanvasSceneObject = {
  id: "canvas:page-1:text:note-1",
  pageId: "page-1",
  source: "canvas",
  kind: "text",
  bounds: { x: 40, y: 140, width: 180, height: 50 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 2,
  text: "복습 메모",
  style: { fontSize: 14 },
  createdAt: 100,
  updatedAt: 120,
};

const SCENE = buildSceneSnapshot({
  mode: "pdf",
  page: { id: "page-1", index: 0, width: 600, height: 800 },
  sceneRevision: 7,
  pdfObjects: [FOCUS_LINE, AMBIGUOUS_A, AMBIGUOUS_B],
  canvasObjects: [EDITABLE_TEXT],
});

function createTurn(
  rawTranscript: string,
  focusObjectId = FOCUS_LINE.id,
): CompletedVoiceTurn {
  const focusObject = SCENE.objectById[focusObjectId];
  return {
    id: "turn-1",
    providerId: "fake-speech",
    providerSessionId: "speech-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 4,
    state: "completed",
    rawTranscript,
    finalSegments: [{ id: "segment-1", index: 0, text: rawTranscript }],
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusObjectId,
      ...(focusObject === undefined ? {} : { focusBounds: focusObject.bounds }),
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "selection",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 7,
      objectId: focusObjectId,
      ...(focusObject === undefined ? {} : { bounds: focusObject.bounds }),
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 7,
      pageIdAtSpeechStart: "page-1",
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
}

function executable(command: DirectEditorCommand): DirectPlannerResult {
  return {
    status: "EXECUTABLE",
    planId: "plan-1",
    turnId: "turn-1",
    sceneRevision: 7,
    normalizedIntent: "테스트 명령",
    relation: "NEW",
    command,
  };
}

function createPipeline(
  plannerResult: DirectPlannerResult,
  disambiguatorResult: ConstructorParameters<
    typeof FakeDirectTargetDisambiguatorProvider
  >[0]["result"] = { status: "NONE" },
  recoveryResult: ConstructorParameters<
    typeof FakeGroundedTargetRecoveryProvider
  >[0] = { status: "NONE" },
) {
  const planner = new FakeDirectCommandPlannerProvider({ result: plannerResult });
  const disambiguator = new FakeDirectTargetDisambiguatorProvider({
    result: disambiguatorResult,
  });
  const resolver = new FrozenTargetResolver();
  const recoveryProvider = new FakeGroundedTargetRecoveryProvider(recoveryResult);
  let now = 100;
  const clock = new InteractionClock(() => now++);
  const pipeline = new DirectCommandPlanningPipeline({
    contextBuilder: new DirectCommandContextBuilder({
      frozenSceneSource: new CurrentRevisionSceneSnapshotSource(() => ({
        scene: SCENE,
      })),
      recentOperationsSource: { getRecentOperations: () => [] },
    }),
    planner,
    resolver,
    disambiguator,
    recovery: new GroundedTargetRecovery({
      provider: recoveryProvider,
      resolver,
    }),
    clock,
    getCurrentSceneRevision: () => 7,
  });
  return { pipeline, planner, disambiguator, recoveryProvider, resolver };
}

describe("DirectCommandPlanningPipeline", () => {
  it("P1 resolves focused underline, guards it, and stops at READY_FOR_EXECUTION", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }));

    const result = await harness.pipeline.plan(createTurn("여기 밑줄"));

    expect(result).toMatchObject({
      status: "READY_FOR_EXECUTION",
      plan: { command: { operation: "underline" } },
      target: { objectId: FOCUS_LINE.id, source: "pdf" },
      disambiguationUsed: false,
      timestamps: {
        plannerRequestedAt: expect.any(Number),
        plannerCompletedAt: expect.any(Number),
        resolverStartedAt: expect.any(Number),
        resolverCompletedAt: expect.any(Number),
        validationStartedAt: expect.any(Number),
        validatedAt: expect.any(Number),
      },
      diagnostics: {
        plannerStatus: "EXECUTABLE",
        targetQueryKind: "relative",
        resolutionStatus: "RESOLVED",
        resolvedTargetKind: "text_span",
        resolverConfidence: expect.any(Number),
        disambiguationUsed: false,
        guardStatus: "PASSED",
      },
    });
    expect(harness.planner.planCallCount).toBe(1);
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
    expect(harness.recoveryProvider.recoverCallCount).toBe(0);
    expect(result).not.toHaveProperty("operationId");
  });

  it("recovers a missing text.create placement before the existing strict guard", async () => {
    const harness = createPipeline(executable({
      capability: "text",
      operation: "create",
      target: { kind: "CURRENT_PAGE" },
      payload: { text: "가나다라" },
    }));

    const result = await harness.pipeline.plan(
      createTurn("왼쪽 위에 가나다라라고 써 줘"),
    );

    expect(result).toMatchObject({
      status: "READY_FOR_EXECUTION",
      plan: {
        placementQuery: {
          reference: { kind: "PAGE" },
          relation: "FREE_SPACE",
          regionHint: "TOP",
          alignment: "START",
        },
      },
      textPlacement: {
        mode: "EXPLICIT_REGION",
        provenance: "TRANSCRIPT_RECOVERED",
        choicePolicy: "EXPLICIT_REGION",
      },
      diagnostics: {
        plannerPlacementPresent: false,
        spatialPhraseEvidenceKind: "EXPLICIT_REGION",
        normalizedPlacementMode: "EXPLICIT_REGION",
        placementProvenance: "TRANSCRIPT_RECOVERED",
        plannerOutputRecovered: true,
        placementRecoveryReason: "MISSING_PLACEMENT_QUERY",
        effectivePlacementQuery: {
          reference: { kind: "PAGE" },
          relation: "FREE_SPACE",
          regionHint: "TOP",
          alignment: "START",
        },
        guardStatus: "PASSED",
      },
    });
    expect(harness.planner.planCallCount).toBe(1);
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
  });

  it("P2 resolves a real enclosing text candidate without inventing offsets", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "underline",
      target: {
        kind: "text_span",
        startAnchor: "세종대왕의",
        endAnchor: "업적",
      },
      payload: {},
    }));

    const result = await harness.pipeline.plan(
      createTurn("세종대왕의부터 업적까지 밑줄"),
    );

    expect(result).toMatchObject({
      status: "READY_FOR_EXECUTION",
      target: { kind: "text_span", text: "세종대왕의 주요 업적" },
    });
    if (result.status !== "READY_FOR_EXECUTION") throw new Error("Expected ready.");
    expect(result.target).not.toHaveProperty("startOffset");
    expect(result.target).not.toHaveProperty("endOffset");
  });

  it("P3 maps C2 back to only the second internal ambiguous candidate", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "highlight",
      target: {
        kind: "semantic_unit",
        unit: "line",
        query: "동일한 AI 문제 문장",
      },
      payload: { color: "yellow" },
    }), { status: "SELECTED", candidateLabel: "C2" });

    const result = await harness.pipeline.plan(
      createTurn("AI 문제점을 설명하는 문장 하이라이트"),
    );

    expect(result).toMatchObject({
      status: "READY_FOR_EXECUTION",
      target: { objectId: AMBIGUOUS_B.id },
      disambiguationUsed: true,
      timestamps: {
        disambiguatorRequestedAt: expect.any(Number),
        disambiguatorCompletedAt: expect.any(Number),
      },
      diagnostics: {
        resolutionStatus: "RESOLVED",
        candidateCount: 2,
        disambiguationUsed: true,
        disambiguationResult: "SELECTED",
        guardStatus: "PASSED",
      },
    });
    expect(harness.disambiguator.disambiguateCallCount).toBe(1);
    expect(harness.recoveryProvider.recoverCallCount).toBe(0);
    const exposed = JSON.stringify(harness.disambiguator.lastInput);
    expect(exposed).not.toContain(AMBIGUOUS_A.id);
    expect(exposed).not.toContain(AMBIGUOUS_B.id);
    expect(exposed).not.toContain("candidateId");
    expect(harness.disambiguator.lastInput?.candidates.map((candidate) => candidate.label))
      .toEqual(["C1", "C2"]);
  });

  it("keeps NONE ambiguous and never falls back to top1", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "highlight",
      target: {
        kind: "semantic_unit",
        unit: "line",
        query: "동일한 AI 문제 문장",
      },
      payload: {},
    }), { status: "NONE" });

    await expect(harness.pipeline.plan(createTurn("동일 문장 하이라이트")))
      .resolves.toMatchObject({
        status: "TARGET_AMBIGUOUS",
        diagnostics: {
          resolutionStatus: "AMBIGUOUS",
          disambiguationUsed: true,
          disambiguationResult: "NONE",
          guardStatus: "NOT_RUN",
        },
      });
    expect(harness.disambiguator.disambiguateCallCount).toBe(1);
  });

  it("P4 returns TARGET_NOT_FOUND without planner retry or disambiguation", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "underline",
      target: { kind: "text_span", quote: "존재하지 않는 문장" },
      payload: {},
    }));

    await expect(harness.pipeline.plan(createTurn("없는 문장 밑줄")))
      .resolves.toMatchObject({ status: "TARGET_NOT_FOUND" });
    expect(harness.planner.planCallCount).toBe(1);
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
    expect(harness.recoveryProvider.recoverCallCount).toBe(0);
  });

  it("calls grounded recovery exactly once for recoverable object NOT_FOUND", async () => {
    const harness = createPipeline(executable({
      capability: "annotation",
      operation: "highlight",
      target: {
        kind: "object",
        objectType: "text",
        query: "역전파 설명한 텍스트",
      },
      payload: {},
    }), { status: "NONE" }, {
      status: "SELECTED",
      candidateLabel: "O1",
    });
    vi.spyOn(harness.resolver, "resolveAsync").mockResolvedValueOnce({
      status: "NOT_FOUND",
      reasonCode: "LOW_CONFIDENCE",
    });

    await expect(harness.pipeline.plan(createTurn("역전파 설명한 텍스트")))
      .resolves.toMatchObject({
        status: "READY_FOR_EXECUTION",
        target: { objectId: EDITABLE_TEXT.id },
        diagnostics: {
          initialResolutionStatus: "NOT_FOUND",
          finalResolutionStatus: "RESOLVED",
          targetRecoveryUsed: true,
          targetRecoveryKind: "object",
          recoveryResult: "SELECTED",
          guardStatus: "PASSED",
        },
      });
    expect(harness.recoveryProvider.recoverCallCount).toBe(1);
    expect(harness.planner.planCallCount).toBe(1);
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
  });

  it("does not recover non-recoverable relative or unsupported subrange results", async () => {
    const relative = createPipeline(executable({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }));
    vi.spyOn(relative.resolver, "resolveAsync").mockResolvedValueOnce({
      status: "NOT_FOUND",
      reasonCode: "FOCUS_NOT_AVAILABLE",
    });
    await expect(relative.pipeline.plan(createTurn("여기 밑줄")))
      .resolves.toMatchObject({ status: "TARGET_NOT_FOUND" });
    expect(relative.recoveryProvider.recoverCallCount).toBe(0);

    const subrange = createPipeline(executable({
      capability: "annotation",
      operation: "underline",
      target: {
        kind: "subrange",
        parent: { kind: "object", objectType: "math", query: "수식" },
        query: "2x",
      },
      payload: {},
    }));
    vi.spyOn(subrange.resolver, "resolveAsync").mockResolvedValueOnce({
      status: "NOT_FOUND",
      reasonCode: "SUBRANGE_UNSUPPORTED",
    });
    await expect(subrange.pipeline.plan(createTurn("수식의 2x 밑줄")))
      .resolves.toMatchObject({ status: "TARGET_NOT_FOUND" });
    expect(subrange.recoveryProvider.recoverCallCount).toBe(0);
  });

  it("P5 defers spatial plans before resolver/disambiguator", async () => {
    const harness = createPipeline({
      status: "DEFER_SPATIAL",
      turnId: "turn-1",
      reasonCode: "SPATIAL_REQUIRED",
    });
    const resolverSpy = vi.spyOn(harness.resolver, "resolve");

    await expect(harness.pipeline.plan(createTurn("오른쪽 여백에 메모")))
      .resolves.toMatchObject({
        status: "DEFERRED_SPATIAL",
        diagnostics: {
          plannerStatus: "DEFER_SPATIAL",
          disambiguationUsed: false,
          guardStatus: "NOT_RUN",
        },
      });
    expect(resolverSpy).not.toHaveBeenCalled();
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
  });

  it("P6 rejects PDF replace_content at Guard and performs no execution", async () => {
    const harness = createPipeline(executable({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "변경" },
    }));

    await expect(harness.pipeline.plan(createTurn("이 문장을 변경")))
      .resolves.toEqual(expect.objectContaining({
        status: "ERROR",
        errorCode: "TARGET_NOT_EDITABLE",
      }));
  });

  it("allows editable text replacement and skips disambiguation for RESOLVED", async () => {
    const harness = createPipeline(executable({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "테스트 완료" },
    }));

    await expect(harness.pipeline.plan(
      createTurn("이 텍스트를 테스트 완료로 바꿔", EDITABLE_TEXT.id),
    )).resolves.toMatchObject({
      status: "READY_FOR_EXECUTION",
      target: { objectId: EDITABLE_TEXT.id, editable: true },
    });
    expect(harness.disambiguator.disambiguateCallCount).toBe(0);
  });
});

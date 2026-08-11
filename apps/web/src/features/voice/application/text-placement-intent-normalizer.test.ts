import { describe, expect, it } from "vitest";
import type {
  DirectCommandContext,
  DirectPlannerDraftResult,
} from "../domain";
import { normalizeTextPlacementIntent } from "./text-placement-intent-normalizer";

const PAGE_ID = "blank-page-1";

describe("normalizeTextPlacementIntent", () => {
  it.each([
    {
      transcript: "왼쪽 위에 가나다라라고 써 줘",
      expectedMode: "EXPLICIT_REGION",
      expectedQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        regionHint: "TOP",
        alignment: "START",
      },
    },
    {
      transcript: "가나다라라고 써 줘",
      expectedMode: "AUTO_FLOW",
      expectedQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        regionHint: "TOP",
        alignment: "START",
      },
    },
    {
      transcript: "빈 공간에 가나다라라고 써 줘",
      expectedMode: "AUTO_FREE_SPACE",
      expectedQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        alignment: "AUTO",
      },
    },
    {
      transcript: "위에 가나다라라고 써 줘",
      expectedMode: "EXPLICIT_REGION",
      expectedQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        regionHint: "TOP",
        alignment: "START",
      },
    },
  ])("recovers '$transcript' without a second planner call", ({
    transcript,
    expectedMode,
    expectedQuery,
  }) => {
    const normalized = normalizeTextPlacementIntent({
      draft: textDraft(),
      context: context(transcript),
    });

    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      command: { payload: { text: "가나다라" } },
      placementQuery: expectedQuery,
    });
    expect(normalized.placement).toMatchObject({
      mode: expectedMode,
      plannerPlacementPresent: false,
      recoveryApplied: true,
      recoveryReason: "MISSING_PLACEMENT_QUERY",
    });
  });

  it("uses a valid frozen focus for a bare relative direction", () => {
    const normalized = normalizeTextPlacementIntent({
      draft: textDraft(),
      context: context("위에 가나다라라고 써 줘", { focus: true }),
    });
    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: {
        reference: { kind: "FOCUS" },
        relation: "ABOVE",
        alignment: "START",
      },
    });
    expect(normalized.placement).toMatchObject({
      mode: "CONTEXTUAL_RELATIVE",
      choicePolicy: "SEMANTIC_CONSTRAINT_REQUIRED",
    });
  });

  it("keeps a deictic relative request semantic so missing history no-commits later", () => {
    const normalized = normalizeTextPlacementIntent({
      draft: textDraft(),
      context: context("그 위에 가나다라라고 써 줘"),
    });
    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: {
        reference: {
          kind: "TARGET",
          query: { kind: "relative", relation: "last_target" },
        },
        relation: "ABOVE",
      },
    });
  });

  it("preserves an existing target-relative planner query as semantic ambiguity", () => {
    const draft = textDraft("그림 설명");
    if (draft.status !== "EXECUTABLE") throw new Error("fixture");
    draft.placementQuery = {
      reference: {
        kind: "TARGET",
        query: { kind: "object", objectType: "image", query: "이 그림" },
      },
      relation: "BELOW",
      alignment: "AUTO",
      overlayIntent: "NONE",
    };

    const normalized = normalizeTextPlacementIntent({
      draft,
      context: context("이 그림 아래에 메모 추가"),
    });

    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: {
        reference: { kind: "TARGET" },
        relation: "BELOW",
      },
    });
    expect(normalized.placement).toMatchObject({
      mode: "CONTEXTUAL_RELATIVE",
      choicePolicy: "SEMANTIC_CONSTRAINT_REQUIRED",
    });
  });

  it("uses a current trusted text.create as the next writing-flow anchor", () => {
    const normalized = normalizeTextPlacementIntent({
      draft: textDraft(),
      context: context("마바사라고 써 줘", { lastText: true }),
    });
    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: {
        reference: {
          kind: "TARGET",
          query: { kind: "object", objectType: "text", relation: "recent" },
        },
        relation: "BELOW",
      },
    });
    expect(normalized.placement).toMatchObject({
      mode: "AUTO_FLOW",
      autoFlowSource: "LAST_TEXT",
    });
  });

  it("ignores stale last-text history and falls through to the page origin", () => {
    const current = context("마바사라고 써 줘", { lastText: true });
    const stale: DirectCommandContext = {
      ...current,
      recentOperations: [],
      pageTargetCatalog: { ...current.pageTargetCatalog, candidates: [] },
    };
    const normalized = normalizeTextPlacementIntent({
      draft: textDraft(),
      context: stale,
    });
    expect(normalized.placement).toMatchObject({
      mode: "AUTO_FLOW",
      autoFlowSource: "PAGE_ORIGIN",
    });
  });

  it("lets conservative transcript evidence override a conflicting planner region", () => {
    const draft = textDraft();
    if (draft.status !== "EXECUTABLE") throw new Error("fixture");
    draft.placementQuery = {
      reference: { kind: "PAGE" },
      relation: "FREE_SPACE",
      regionHint: "BOTTOM",
      alignment: "END",
      overlayIntent: "NONE",
    };
    const normalized = normalizeTextPlacementIntent({
      draft,
      context: context("왼쪽 위에 가나다라라고 써 줘"),
    });
    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: { regionHint: "TOP", alignment: "START" },
    });
    expect(normalized.placement).toMatchObject({
      provenance: "TRANSCRIPT_RECOVERED",
      conflictRecovered: true,
      recoveryReason: "PLACEMENT_CONFLICT_RECOVERED",
    });
  });

  it.each([
    ["왼쪽 위라고 써 줘", "왼쪽 위"],
    ["빈 공간이라고 써 줘", "빈 공간"],
    ["오른쪽이라고 적어 줘", "오른쪽"],
  ])("protects spatial words inside content for '%s'", (transcript, content) => {
    const draft = textDraft(content);
    const normalized = normalizeTextPlacementIntent({ draft, context: context(transcript) });
    expect(normalized.result).toMatchObject({
      status: "EXECUTABLE",
      command: { payload: { text: content } },
      placementQuery: { regionHint: "TOP", alignment: "START" },
    });
    expect(normalized.placement?.mode).toBe("AUTO_FLOW");
  });
});

function textDraft(content = "가나다라"): DirectPlannerDraftResult {
  return {
    status: "EXECUTABLE",
    planId: "plan-1",
    turnId: "turn-1",
    sceneRevision: 10,
    normalizedIntent: `${content} 쓰기`,
    relation: "NEW",
    command: {
      capability: "text",
      operation: "create",
      target: { kind: "CURRENT_PAGE" },
      payload: { text: content },
    },
  };
}

function context(
  transcript: string,
  options: { readonly focus?: boolean; readonly lastText?: boolean } = {},
): DirectCommandContext {
  const focusBounds = { x: 100, y: 100, width: 100, height: 40 };
  const textCandidate = {
    candidateId: "candidate:last-text",
    source: "ggulnote" as const,
    type: "text" as const,
    pageId: PAGE_ID,
    sourceObjectId: "text-last",
    sceneObjectId: "text-last",
    bounds: { x: 80, y: 120, width: 160, height: 60 },
    editable: true,
    annotatable: true,
  };
  const recentOperation = {
    operationId: "operation:last-text",
    pageId: PAGE_ID,
    operationType: "CREATE_ANNOTATION" as const,
    annotationId: "text-last",
    createdAt: 9,
    targetSceneObjectId: "text-last",
  };
  const turn = {
    id: "turn-1",
    providerId: "test",
    providerSessionId: "session-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed" as const,
    rawTranscript: transcript,
    finalSegments: [{ id: "segment-1", index: 0, text: transcript }],
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "blank" as const,
      sceneRevision: 10,
      ...(options.focus
        ? { focusObjectId: "focus-1", focusBounds }
        : {}),
      focusSource: options.focus ? "selection" as const : "page" as const,
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: options.focus ? "selection" as const : "page" as const,
      capturedAt: 2,
      pageId: PAGE_ID,
      sceneRevision: 10,
      ...(options.focus ? { objectId: "focus-1", bounds: focusBounds } : {}),
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 10,
      pageIdAtSpeechStart: PAGE_ID,
      currentSceneRevisionAtCompletion: 10,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: {
      interimUpdateCount: 0,
      finalSegmentCount: 1,
      providerRestartCount: 0,
    },
  };
  return {
    turn,
    frozenContext: turn.frozenContext,
    pageTargetCatalog: {
      pageId: PAGE_ID,
      sceneRevision: 10,
      candidates: options.lastText ? [textCandidate] : [],
    },
    recentOperations: options.lastText ? [recentOperation] : [],
    plannerContext: {
      turn: {
        turnId: "turn-1",
        language: "ko-KR",
        rawFinalTranscript: transcript,
      },
      frozenContext: {
        pageId: PAGE_ID,
        sceneMode: "blank",
        sceneRevision: 10,
        focusSource: options.focus ? "selection" : "page",
        focusStale: false,
        capturedAt: 2,
        focus: options.focus
          ? {
              kind: "text",
              source: "ggulnote",
              editable: true,
              annotatable: true,
              bounds: focusBounds,
            }
          : null,
      },
      allowedCommands: ["text.create"],
    },
    ...(options.lastText
      ? {
          historySnapshot: {
            lastSuccessfulOperation: {
              turnId: "turn-before",
              planId: "plan-before",
              relation: "NEW" as const,
              command: {
                capability: "text" as const,
                operation: "create" as const,
                target: { kind: "CURRENT_PAGE" as const },
                payload: { text: "이전 텍스트" },
              },
              target: { kind: "CURRENT_PAGE" as const },
              resultStatus: "COMMITTED" as const,
              editorOperationId: "operation:last-text",
              editorAnnotationId: "text-last",
              committedAt: 9,
            },
            lastReusableTarget: null,
          },
        }
      : {}),
  };
}

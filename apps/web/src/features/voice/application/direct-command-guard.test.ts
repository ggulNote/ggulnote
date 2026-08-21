import { describe, expect, it } from "vitest";
import type {
  DirectEditorCommand,
  DirectPlannerResult,
  ExecutableDirectPlan,
  FrozenVoiceTurnContext,
  PageTargetCandidate,
  PageTargetCatalog,
  TargetResolutionResult,
} from "../domain";
import { guardDirectCommandPlan } from "./direct-command-guard";

const FROZEN_CONTEXT: FrozenVoiceTurnContext = {
  pageId: "page-1",
  sceneMode: "pdf",
  sceneRevision: 7,
  focusSource: "selection",
  focusStale: false,
  capturedAt: 10,
};

const PDF_TEXT: PageTargetCandidate = {
  candidateId: "candidate:pdf-line",
  source: "pdf",
  type: "line",
  pageId: "page-1",
  sceneObjectId: "pdf:line:1",
  text: "PDF 원문",
  bounds: { x: 10, y: 10, width: 200, height: 20 },
  editable: false,
  annotatable: true,
  semanticUnit: "line",
};

const EDITABLE_TEXT: PageTargetCandidate = {
  candidateId: "candidate:editable-text",
  source: "ggulnote",
  type: "text",
  pageId: "page-1",
  sceneObjectId: "canvas:text:1",
  text: "편집 가능한 메모",
  bounds: { x: 20, y: 50, width: 180, height: 60 },
  editable: true,
  annotatable: true,
};

const CATALOG: PageTargetCatalog = {
  pageId: "page-1",
  sceneRevision: 7,
  candidates: [PDF_TEXT, EDITABLE_TEXT],
};

function plan(command: DirectEditorCommand): ExecutableDirectPlan {
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

function resolution(candidate: PageTargetCandidate): TargetResolutionResult {
  return {
    status: "RESOLVED",
    target: {
      kind: "text_span",
      candidateId: candidate.candidateId,
      pageId: candidate.pageId,
      sceneRevision: 7,
      source: candidate.source,
      type: candidate.type,
      objectId: candidate.sceneObjectId,
      text: candidate.text ?? "",
      bounds: candidate.bounds === undefined ? undefined : [candidate.bounds],
      editable: candidate.editable,
      annotatable: candidate.annotatable,
    },
    confidence: 1,
    evidence: {
      typeMatch: 1,
      lexicalMatch: 1,
      fuzzyMatch: 1,
      semanticMatch: null,
      mathMatch: null,
      temporalMatch: null,
      structuralMatch: 1,
      focusMatch: null,
    },
  };
}

function guard(
  result: DirectPlannerResult,
  targetResolution?: TargetResolutionResult,
  currentSceneRevision = 7,
) {
  return guardDirectCommandPlan({
    result,
    expectedTurnId: "turn-1",
    frozenContext: FROZEN_CONTEXT,
    catalog: CATALOG,
    currentSceneRevision,
    ...(targetResolution === undefined ? {} : { resolution: targetResolution }),
  });
}

describe("guardDirectCommandPlan", () => {
  it.each(["underline", "highlight"] as const)(
    "allows PDF text + annotation.%s without mutating PDF source",
    (operation) => {
      const command: DirectEditorCommand = operation === "underline"
        ? {
            capability: "annotation",
            operation,
            target: { kind: "relative", relation: "focused" },
            payload: {},
          }
        : {
            capability: "annotation",
            operation,
            target: { kind: "relative", relation: "focused" },
            payload: { color: "#facc15" },
          };

      expect(guard(plan(command), resolution(PDF_TEXT))).toMatchObject({
        status: "ALLOWED",
        target: { source: "pdf", editable: false, annotatable: true },
      });
    },
  );

  it("rejects PDF source text replacement", () => {
    expect(guard(plan({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "변경" },
    }), resolution(PDF_TEXT))).toEqual({
      status: "REJECTED",
      errorCode: "TARGET_NOT_EDITABLE",
    });
  });

  it("allows Ggulnote editable text replacement", () => {
    expect(guard(plan({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "변경" },
    }), resolution(EDITABLE_TEXT))).toMatchObject({
      status: "ALLOWED",
      target: {
        source: "ggulnote",
        type: "text",
        editable: true,
      },
    });
  });

  it("allows a supported spatial text create and preserves the trusted anchor", () => {
    const spatialPlan: ExecutableDirectPlan = {
      ...plan({
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "그림 설명" },
      }),
      placementQuery: {
        reference: {
          kind: "TARGET",
          query: { kind: "object", objectType: "image", query: "이 그림" },
        },
        relation: "BELOW",
      },
    };

    expect(guardDirectCommandPlan({
      result: spatialPlan,
      expectedTurnId: "turn-1",
      frozenContext: FROZEN_CONTEXT,
      catalog: CATALOG,
      currentSceneRevision: 7,
      spatialAnchorResolution: resolution(PDF_TEXT),
    })).toMatchObject({
      status: "ALLOWED",
      spatialAnchorTarget: {
        candidateId: PDF_TEXT.candidateId,
        objectId: PDF_TEXT.sceneObjectId,
      },
    });
  });

  it("rejects stale revisions, spatial plans, and commands outside the allowlist", () => {
    const underline = plan({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    });
    expect(guard(underline, resolution(PDF_TEXT), 8)).toEqual({
      status: "REJECTED",
      errorCode: "STALE_SCENE",
    });
    expect(guard({
      status: "DEFER_SPATIAL",
      turnId: "turn-1",
      reasonCode: "SPATIAL_REQUIRED",
    })).toEqual({
      status: "REJECTED",
      errorCode: "SPATIAL_REQUIRED",
    });
    expect(guard({
      ...underline,
      placementQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
      },
    }, resolution(PDF_TEXT))).toEqual({
      status: "REJECTED",
      errorCode: "SPATIAL_REQUIRED",
    });
    expect(guardDirectCommandPlan({
      result: underline,
      expectedTurnId: "turn-1",
      frozenContext: FROZEN_CONTEXT,
      catalog: CATALOG,
      currentSceneRevision: 7,
      resolution: resolution(PDF_TEXT),
      allowedCommands: [],
    })).toEqual({
      status: "REJECTED",
      errorCode: "UNSUPPORTED_COMMAND",
    });
  });
});

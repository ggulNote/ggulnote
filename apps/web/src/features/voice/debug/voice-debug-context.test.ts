import type { SceneMode } from "@ggulnote/editor-core";
import type { FrozenVoiceTurnContext } from "../domain";
import { describe, expect, it } from "vitest";
import { compareFrozenAndCurrentContext, toVoiceDebugContextSnapshot } from "./voice-debug-context";
import type { VoiceDebugContextSnapshot } from "./voice-debug-types";

const frozenContext: VoiceDebugContextSnapshot = {
  pageId: "page-1",
  sceneMode: "pdf" as const,
  sceneRevision: 101,
  focusSource: "gaze",
  focusObjectId: "paragraph-12",
  focusBounds: {
    x: 10,
    y: 20,
    width: 100,
    height: 40,
  },
  focusStale: false,
  capturedAt: 20,
};

describe("compareFrozenAndCurrentContext", () => {
  it("returns stable values when frozen and current context match", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      currentContext: {
        pageId: "page-1",
        sceneRevision: 101,
        focusSource: "gaze",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: false,
      frozenFocusStale: false,
    });
  });

  it("uses completed scene/page flags when provided", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      completedSceneChangeFlags: {
        pageChangedDuringTurn: true,
        sceneChangedDuringTurn: false,
      },
      currentContext: {
        pageId: "page-2",
        sceneRevision: 202,
        focusSource: "gaze",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: true,
      sceneChanged: false,
      focusChanged: false,
      frozenFocusStale: false,
    });
  });

  it("detects page and scene divergence", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      currentContext: {
        pageId: "page-2",
        sceneRevision: 202,
        focusSource: "gaze",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: true,
      sceneChanged: true,
      focusChanged: false,
      frozenFocusStale: false,
    });
  });

  it("detects focus change by object id", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      currentContext: {
        pageId: "page-1",
        sceneRevision: 101,
        focusSource: "gaze",
        focusObjectId: "paragraph-19",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: true,
      frozenFocusStale: false,
    });
  });

  it("detects focus change by source", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      currentContext: {
        pageId: "page-1",
        sceneRevision: 101,
        focusSource: "selection",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: true,
      frozenFocusStale: false,
    });
  });

  it("detects focus change by bounds", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext,
      currentContext: {
        pageId: "page-1",
        sceneRevision: 101,
        focusSource: "gaze",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 25,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: true,
      frozenFocusStale: false,
    });
  });

  it("detects focus stale flip and keeps frozen stale state", () => {
    expect(compareFrozenAndCurrentContext({
      frozenContext: {
        ...frozenContext,
        focusStale: true,
      },
      currentContext: {
        pageId: "page-1",
        sceneRevision: 101,
        focusSource: "gaze",
        focusObjectId: "paragraph-12",
        focusBounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
        focusStale: false,
      },
    })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: true,
      frozenFocusStale: true,
    });
  });

  it("returns safe defaults when current context is unavailable", () => {
    expect(compareFrozenAndCurrentContext({ frozenContext })).toMatchObject({
      pageChanged: false,
      sceneChanged: false,
      focusChanged: false,
      frozenFocusStale: false,
    });
  });
});

describe("toVoiceDebugContextSnapshot", () => {
  const original: FrozenVoiceTurnContext = {
    pageId: "page-1",
    sceneMode: "pdf" as SceneMode,
    sceneRevision: 101,
    focusSource: "selection",
    focusObjectId: "paragraph-1",
    focusBounds: { x: 10, y: 20, width: 100, height: 40 },
    focusStale: false,
    capturedAt: 15,
  };

  it("creates immutable debug snapshot from frozen context", () => {
    const snapshot = toVoiceDebugContextSnapshot(original);
    expect(snapshot).toMatchObject({
      pageId: original.pageId,
      sceneMode: original.sceneMode,
      sceneRevision: original.sceneRevision,
      focusSource: original.focusSource,
      focusObjectId: original.focusObjectId,
      focusBounds: original.focusBounds,
      focusStale: original.focusStale,
      capturedAt: original.capturedAt,
    });

    expect(snapshot).not.toBe(original);
    expect(snapshot.focusBounds).not.toBe(original.focusBounds);
    expect(original.pageId).toBe("page-1");
    expect(original.focusBounds?.x).toBe(10);
  });
});

import { buildSceneSnapshot, type TextSceneObject } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { SceneVoiceTurnContextSource, resolveVoiceFocusSnapshot } from "./voice-turn-context-source";

const focusedText: TextSceneObject = {
  id: "canvas:page-3:text:note-1",
  pageId: "page-3",
  source: "canvas",
  kind: "text",
  bounds: { x: 10, y: 20, width: 80, height: 30 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 1,
  text: "focus",
  style: { fontSize: 16 },
};

const scene = buildSceneSnapshot({
  mode: "pdf",
  page: { id: "page-3", index: 2, width: 600, height: 800 },
  sceneRevision: 812,
  canvasObjects: [focusedText],
});

describe("resolveVoiceFocusSnapshot", () => {
  it("uses valid gaze before selection and preserves canonical bounds", () => {
    const result = resolveVoiceFocusSnapshot(scene, {
      gaze: {
        source: "gaze",
        objectId: focusedText.id,
        bounds: focusedText.bounds,
        capturedAt: 10,
        confidence: 0.9,
      },
      selection: {
        source: "selection",
        objectId: focusedText.id,
        capturedAt: 9,
      },
    }, 20, 0.5);

    expect(result).toMatchObject({
      source: "gaze",
      pageId: "page-3",
      sceneRevision: 812,
      objectId: focusedText.id,
      bounds: focusedText.bounds,
      stale: false,
    });
  });

  it("falls back from low-confidence gaze to selection", () => {
    const result = resolveVoiceFocusSnapshot(scene, {
      gaze: { source: "gaze", capturedAt: 10, confidence: 0.2 },
      selection: { source: "selection", objectId: focusedText.id, capturedAt: 9 },
    }, 20, 0.5);
    expect(result.source).toBe("selection");
    expect(result.bounds).toEqual(focusedText.bounds);
  });

  it("marks missing object focus stale and removes object-derived identity", () => {
    const result = resolveVoiceFocusSnapshot(scene, {
      selection: {
        source: "selection",
        objectId: "missing",
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        capturedAt: 10,
      },
    }, 20);
    expect(result.stale).toBe(true);
    expect(result.objectId).toBeUndefined();
    expect(result.bounds).toBeUndefined();
  });

  it("marks focus stale when the candidate object revision no longer matches", () => {
    const result = resolveVoiceFocusSnapshot(scene, {
      selection: {
        source: "selection",
        objectId: focusedText.id,
        objectRevision: focusedText.objectRevision + 1,
        bounds: focusedText.bounds,
        capturedAt: 10,
      },
    }, 20);

    expect(result.stale).toBe(true);
    expect(result.objectId).toBeUndefined();
    expect(result.bounds).toBeUndefined();
  });

  it("keeps a bounds-only ROI and supports no focus", () => {
    const roi = resolveVoiceFocusSnapshot(scene, {
      recentFocus: {
        source: "recent-focus",
        bounds: { x: 30, y: 40, width: 50, height: 60 },
        capturedAt: 10,
      },
    }, 20);
    expect(roi.bounds).toEqual({ x: 30, y: 40, width: 50, height: 60 });
    expect(roi.stale).toBe(false);
    expect(resolveVoiceFocusSnapshot(scene, {}, 20).source).toBe("none");
  });

  it("uses recent focus and page focus in deterministic fallback order", () => {
    const recent = resolveVoiceFocusSnapshot(scene, {
      recentFocus: { source: "recent-focus", capturedAt: 10 },
      page: { source: "page", capturedAt: 9 },
    }, 20);
    expect(recent.source).toBe("recent-focus");

    const page = resolveVoiceFocusSnapshot(scene, {
      page: { source: "page", capturedAt: 9 },
    }, 20);
    expect(page.source).toBe("page");
  });
});

describe("SceneVoiceTurnContextSource", () => {
  it("captures page, mode, revision, and focus from one scene read", () => {
    let reads = 0;
    const source = new SceneVoiceTurnContextSource({
      readCurrentContext: () => {
        reads += 1;
        return {
          scene,
          focus: {
            selection: {
              source: "selection",
              objectId: focusedText.id,
              bounds: focusedText.bounds,
              capturedAt: 18,
            },
          },
        };
      },
    });
    const capture = source.capture(20);
    expect(reads).toBe(1);
    expect(capture.frozenContext).toMatchObject({
      pageId: "page-3",
      sceneMode: "pdf",
      sceneRevision: 812,
      focusObjectId: focusedText.id,
      focusBounds: focusedText.bounds,
      capturedAt: 20,
    });
  });
});

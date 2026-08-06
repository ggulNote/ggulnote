import type { Rect, SceneSnapshot } from "@ggulnote/editor-core";
import type {
  FrozenVoiceTurnContext,
  VoiceFocusSnapshot,
  VoiceFocusSource,
} from "../domain";

export interface VoiceFocusCandidate {
  source: Exclude<VoiceFocusSource, "none">;
  objectId?: string;
  bounds?: Rect;
  capturedAt: number;
  gazeSampleId?: string;
  confidence?: number;
}

export interface VoiceFocusCandidates {
  gaze?: VoiceFocusCandidate;
  selection?: VoiceFocusCandidate;
  recentFocus?: VoiceFocusCandidate;
  page?: VoiceFocusCandidate;
}

export interface VoiceTurnContextRead {
  scene: SceneSnapshot;
  focus: VoiceFocusCandidates;
}

export interface VoiceTurnContextCapture {
  frozenContext: FrozenVoiceTurnContext;
  focusSnapshot: VoiceFocusSnapshot;
}

export interface VoiceCurrentSceneReference {
  pageId: string;
  sceneRevision: number;
}

export interface VoiceTurnContextSource {
  capture(capturedAt: number): VoiceTurnContextCapture;
  getCurrentSceneReference(): VoiceCurrentSceneReference;
}

export interface SceneVoiceTurnContextSourceOptions {
  readCurrentContext: () => VoiceTurnContextRead;
  minimumGazeConfidence?: number;
}

export class SceneVoiceTurnContextSource implements VoiceTurnContextSource {
  private readonly minimumGazeConfidence: number;

  public constructor(private readonly options: SceneVoiceTurnContextSourceOptions) {
    this.minimumGazeConfidence = options.minimumGazeConfidence ?? 0;
  }

  public capture(capturedAt: number): VoiceTurnContextCapture {
    const current = this.options.readCurrentContext();
    const focusSnapshot = resolveVoiceFocusSnapshot(
      current.scene,
      current.focus,
      capturedAt,
      this.minimumGazeConfidence,
    );
    const frozenContext: FrozenVoiceTurnContext = {
      pageId: current.scene.page.id,
      sceneMode: current.scene.mode,
      sceneRevision: current.scene.sceneRevision,
      focusSource: focusSnapshot.source,
      focusStale: focusSnapshot.stale,
      capturedAt,
    };
    if (focusSnapshot.objectId !== undefined) {
      frozenContext.focusObjectId = focusSnapshot.objectId;
    }
    if (focusSnapshot.bounds !== undefined) {
      frozenContext.focusBounds = cloneRect(focusSnapshot.bounds);
    }

    return { frozenContext, focusSnapshot };
  }

  public getCurrentSceneReference(): VoiceCurrentSceneReference {
    const { scene } = this.options.readCurrentContext();
    return { pageId: scene.page.id, sceneRevision: scene.sceneRevision };
  }
}

export function resolveVoiceFocusSnapshot(
  scene: SceneSnapshot,
  candidates: VoiceFocusCandidates,
  capturedAt: number,
  minimumGazeConfidence = 0,
): VoiceFocusSnapshot {
  const candidate = selectFocusCandidate(candidates, minimumGazeConfidence);
  if (!candidate) {
    return {
      source: "none",
      capturedAt,
      pageId: scene.page.id,
      sceneRevision: scene.sceneRevision,
      stale: false,
    };
  }

  const objectExists = candidate.objectId === undefined
    || scene.objectById[candidate.objectId] !== undefined;
  const stale = !objectExists;
  const snapshot: VoiceFocusSnapshot = {
    source: candidate.source,
    capturedAt,
    pageId: scene.page.id,
    sceneRevision: scene.sceneRevision,
    stale,
  };

  if (!stale && candidate.objectId !== undefined) snapshot.objectId = candidate.objectId;
  const resolvedBounds = candidate.bounds
    ?? (candidate.objectId ? scene.objectById[candidate.objectId]?.bounds : undefined);
  if (!stale && resolvedBounds !== undefined) {
    snapshot.bounds = cloneRect(resolvedBounds);
  } else if (candidate.objectId === undefined && candidate.bounds !== undefined) {
    snapshot.bounds = cloneRect(candidate.bounds);
  }
  if (candidate.gazeSampleId !== undefined) snapshot.gazeSampleId = candidate.gazeSampleId;
  if (candidate.confidence !== undefined) snapshot.confidence = candidate.confidence;
  return snapshot;
}

function selectFocusCandidate(
  candidates: VoiceFocusCandidates,
  minimumGazeConfidence: number,
): VoiceFocusCandidate | undefined {
  const gaze = candidates.gaze;
  if (gaze?.source === "gaze" && (gaze.confidence ?? 0) >= minimumGazeConfidence) {
    return gaze;
  }
  return candidates.selection ?? candidates.recentFocus ?? candidates.page;
}

function cloneRect(rect: Rect): Rect {
  return { ...rect };
}

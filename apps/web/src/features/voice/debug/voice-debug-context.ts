import type { Rect, SceneMode } from "@ggulnote/editor-core";
import type { FrozenVoiceTurnContext } from "../domain";
import type { VoiceDebugContextDiff, VoiceDebugContextSnapshot } from "./voice-debug-types";

export interface VoiceCurrentContextSnapshot {
  pageId: string;
  sceneMode: SceneMode;
  sceneRevision: number;
  focusSource: VoiceDebugContextSnapshot["focusSource"];
  focusObjectId?: string;
  focusBounds?: Rect;
  focusStale: boolean;
  capturedAt: number;
}

export interface VoiceContextDiffInput {
  frozenContext?: VoiceDebugContextSnapshot;
  completedSceneChangeFlags?: {
    pageChangedDuringTurn: boolean;
    sceneChangedDuringTurn: boolean;
  };
  currentContext?: Pick<
    VoiceCurrentContextSnapshot,
    "pageId" | "sceneRevision" | "focusSource" | "focusObjectId" | "focusBounds" | "focusStale"
  >;
}

export function toVoiceDebugContextSnapshot(
  frozenContext: FrozenVoiceTurnContext,
): VoiceDebugContextSnapshot {
  return {
    pageId: frozenContext.pageId,
    sceneMode: frozenContext.sceneMode,
    sceneRevision: frozenContext.sceneRevision,
    focusSource: frozenContext.focusSource,
    focusObjectId: frozenContext.focusObjectId,
    focusBounds: frozenContext.focusBounds
      ? { ...frozenContext.focusBounds }
      : undefined,
    focusStale: frozenContext.focusStale,
    capturedAt: frozenContext.capturedAt,
  };
}

export function compareFrozenAndCurrentContext(input: VoiceContextDiffInput): VoiceDebugContextDiff {
  const frozen = input.frozenContext;
  const current = input.currentContext;

  const pageChanged = input.completedSceneChangeFlags
    ? input.completedSceneChangeFlags.pageChangedDuringTurn
    : frozen !== undefined && current !== undefined
      ? current.pageId !== frozen.pageId
      : false;

  const sceneChanged = input.completedSceneChangeFlags
    ? input.completedSceneChangeFlags.sceneChangedDuringTurn
    : frozen !== undefined && current !== undefined
      ? current.sceneRevision !== frozen.sceneRevision
      : false;

  const focusChanged = frozen !== undefined && current !== undefined
    ? isFocusChanged(frozen, current)
    : false;

  return {
    pageChanged,
    sceneChanged,
    focusChanged,
    frozenFocusStale: frozen?.focusStale ?? false,
  };
}

function isFocusChanged(
  frozen: VoiceDebugContextSnapshot,
  current: Pick<
    VoiceCurrentContextSnapshot,
    "focusSource" | "focusObjectId" | "focusBounds" | "focusStale"
  >,
): boolean {
  if (current.focusSource !== frozen.focusSource) return true;
  if (current.focusStale !== frozen.focusStale) return true;
  if (current.focusObjectId !== frozen.focusObjectId) return true;

  if (!frozen.focusBounds && current.focusBounds) return true;
  if (frozen.focusBounds && !current.focusBounds) return true;

  return frozen.focusBounds !== undefined && current.focusBounds !== undefined
    ? areRectsDifferent(frozen.focusBounds, current.focusBounds)
    : false;
}

function areRectsDifferent(left: Rect, right: Rect): boolean {
  return left.x !== right.x
    || left.y !== right.y
    || left.width !== right.width
    || left.height !== right.height;
}

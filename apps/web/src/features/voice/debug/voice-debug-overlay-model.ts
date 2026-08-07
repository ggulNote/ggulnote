import type { Rect } from "@ggulnote/editor-core";

export interface VoiceDebugOverlayStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toVoiceDebugOverlayStyle(
  bounds: Rect | undefined,
): VoiceDebugOverlayStyle | undefined {
  if (!bounds) return undefined;
  return {
    left: finite(bounds.x),
    top: finite(bounds.y),
    width: nonNegative(bounds.width),
    height: nonNegative(bounds.height),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value));
}

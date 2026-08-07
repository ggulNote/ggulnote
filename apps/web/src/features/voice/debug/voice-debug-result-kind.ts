import type { VoiceTurnControllerState } from "../domain";
import type { VoiceDebugResultKind } from "./voice-debug-types";

export function resolveVoiceTurnResultKind(
  state: VoiceTurnControllerState,
): VoiceDebugResultKind {
  switch (state.status) {
    case "completed":
      return "Completed";
    case "discarded":
      return "Discarded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "unsupported":
      return "Unsupported";
    case "starting":
    case "capturing":
    case "finalizing":
      return "In Progress";
    case "idle":
      return "Idle";
  }
}

import type { VoiceTurnControllerStatus } from "./voice-turn-types";

export type VoiceTurnLifecycleAction =
  | { type: "START_REQUESTED" }
  | { type: "SPEECH_STARTED" }
  | { type: "STOP_REQUESTED" }
  | { type: "SPEECH_ENDED" }
  | { type: "COMPLETED" }
  | { type: "DISCARDED" }
  | { type: "CANCELLED" }
  | { type: "FAILED" }
  | { type: "UNSUPPORTED" };

const TERMINAL_STATES = new Set<VoiceTurnControllerStatus>([
  "completed",
  "discarded",
  "cancelled",
  "failed",
  "unsupported",
]);

export function reduceVoiceTurnLifecycle(
  state: VoiceTurnControllerStatus,
  action: VoiceTurnLifecycleAction,
): VoiceTurnControllerStatus {
  switch (action.type) {
    case "START_REQUESTED":
      return state === "idle" || TERMINAL_STATES.has(state) ? "starting" : state;
    case "SPEECH_STARTED":
      return state === "starting" ? "capturing" : state;
    case "STOP_REQUESTED":
      return state === "starting" || state === "capturing" ? "finalizing" : state;
    case "SPEECH_ENDED":
      return state === "capturing" ? "finalizing" : state;
    case "COMPLETED":
      return state === "capturing" || state === "finalizing" ? "completed" : state;
    case "DISCARDED":
      return state === "starting" || state === "capturing" || state === "finalizing" ? "discarded" : state;
    case "CANCELLED":
      return state === "starting" || state === "capturing" || state === "finalizing" ? "cancelled" : state;
    case "FAILED":
      return state === "starting" || state === "capturing" || state === "finalizing" ? "failed" : state;
    case "UNSUPPORTED":
      return state === "starting" ? "unsupported" : state;
  }
}

export function isTerminalVoiceTurnStatus(status: VoiceTurnControllerStatus): boolean {
  return TERMINAL_STATES.has(status);
}

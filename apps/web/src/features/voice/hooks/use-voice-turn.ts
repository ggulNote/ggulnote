"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { VoiceTurnControllerState } from "../domain";
import type {
  VoiceTurnController,
  VoiceTurnStateListener,
} from "../application";

export type VoiceTurnControllerPort = Pick<
  VoiceTurnController,
  "getState" | "start" | "stop" | "cancel" | "subscribe"
>;

export interface UseVoiceTurnResult {
  state: VoiceTurnControllerState;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

interface VoiceTurnExternalStore {
  getSnapshot(): VoiceTurnControllerState;
  subscribe(listener: () => void): () => void;
}

export function useVoiceTurn(
  controller: VoiceTurnControllerPort,
): UseVoiceTurnResult {
  const store = useMemo(
    () => createVoiceTurnExternalStore(controller),
    [controller],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const start = useCallback(() => controller.start(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return { state, start, stop, cancel };
}

function createVoiceTurnExternalStore(
  controller: VoiceTurnControllerPort,
): VoiceTurnExternalStore {
  let snapshot = controller.getState();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      snapshot = controller.getState();
      const handleState: VoiceTurnStateListener = (next) => {
        snapshot = next;
        listener();
      };
      return controller.subscribe(handleState);
    },
  };
}

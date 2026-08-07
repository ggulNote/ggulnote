"use client";

import type { VoiceTurnController } from "../application";
import { useVoiceTurn } from "../hooks";
import { VoiceTrigger } from "../presentation";

export interface VoiceTriggerControlProps {
  controller: VoiceTurnController;
  disabled?: boolean;
}

export function VoiceTriggerControl({
  controller,
  disabled = false,
}: VoiceTriggerControlProps): React.ReactElement {
  const { state, start, stop, cancel } = useVoiceTurn(controller);
  return (
    <VoiceTrigger
      state={state}
      disabled={disabled}
      onStart={start}
      onStop={stop}
      onCancel={cancel}
    />
  );
}

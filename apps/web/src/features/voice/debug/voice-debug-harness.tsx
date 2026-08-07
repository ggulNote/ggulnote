"use client";

import { useEffect, useState } from "react";
import {
  createVoiceDebugRuntime,
  type VoiceDebugProviderKind,
  type VoiceDebugRuntimeContract,
} from "./voice-debug-runtime";
import { VoiceDebugPanel } from "./voice-debug-panel";

export function VoiceDebugHarness() {
  const [runtime, setRuntime] = useState<VoiceDebugRuntimeContract>(
    () => createVoiceDebugRuntime("fake"),
  );

  useEffect(() => () => runtime.dispose(), [runtime]);

  const changeProvider = (kind: VoiceDebugProviderKind) => {
    if (kind === runtime.providerKind) return;
    setRuntime(createVoiceDebugRuntime(kind));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <span className="font-semibold text-slate-700">Provider</span>
        <button
          type="button"
          onClick={() => changeProvider("fake")}
          className={providerButtonClass(runtime.providerKind === "fake")}
        >
          Fake Speech
        </button>
        <button
          type="button"
          onClick={() => changeProvider("browser")}
          className={providerButtonClass(runtime.providerKind === "browser")}
        >
          Browser Web Speech
        </button>
      </div>
      <VoiceDebugPanel runtime={runtime} />
    </div>
  );
}

function providerButtonClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-950 px-3 py-2 text-white"
    : "rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50";
}

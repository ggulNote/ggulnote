import Link from "next/link";
import { VoiceDebugHarness } from "@/features/voice/debug/voice-debug-harness";

export default function VoiceDebugPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 md:p-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link
          href="/debug"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Back to /debug
        </Link>
        <p className="text-xs text-slate-500">No audio is recorded or persisted.</p>
      </div>
      <VoiceDebugHarness />
    </main>
  );
}

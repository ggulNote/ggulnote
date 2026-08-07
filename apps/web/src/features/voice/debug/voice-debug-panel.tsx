"use client";

import { useState, useSyncExternalStore } from "react";
import type { VoiceDebugRuntimeContract } from "./voice-debug-runtime";
import type { VoiceDebugFakeScenario } from "./fake-provider-scenarios";
import { toVoiceDebugOverlayStyle } from "./voice-debug-overlay-model";
import type {
  VoiceDebugContextSnapshot,
  VoiceDebugMetrics,
  VoiceDebugSnapshot,
} from "./voice-debug-types";

export interface VoiceDebugPanelProps {
  runtime: VoiceDebugRuntimeContract;
}

const SCENARIOS: Array<{ value: VoiceDebugFakeScenario; label: string }> = [
  { value: "happy-path", label: "Happy Path" },
  { value: "self-correction", label: "Self Correction" },
  { value: "error-permission", label: "Permission Denied" },
  { value: "error-no-speech", label: "No Speech" },
  { value: "error-network", label: "Network Error" },
  { value: "cancel", label: "Cancel" },
];

export function VoiceDebugPanel({ runtime }: VoiceDebugPanelProps) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [scenario, setScenario] = useState<VoiceDebugFakeScenario>("happy-path");
  const [showFrozenBounds, setShowFrozenBounds] = useState(true);
  const [showCurrentBounds, setShowCurrentBounds] = useState(true);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-300 bg-slate-950 p-4 text-slate-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Voice diagnostics
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Voice Turn Debug</h1>
          </div>
          <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase text-cyan-200">
            {runtime.providerKind}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ControlButton label="Start" onClick={() => { void runtime.start(); }} />
          <ControlButton label="Stop" onClick={() => runtime.stop()} />
          <ControlButton label="Cancel" onClick={() => runtime.cancel()} />
          <ControlButton label="Retry" onClick={() => { void runtime.retry(); }} />
          <ControlButton label="Clear Event Log" onClick={() => runtime.clearEvents()} />
          <ControlButton label="Clear Turn History" onClick={() => runtime.clearHistory()} />
        </div>
        {runtime.providerKind === "fake" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-700 pt-4">
            <label htmlFor="voice-debug-scenario" className="text-sm text-slate-300">
              Fake scenario
            </label>
            <select
              id="voice-debug-scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as VoiceDebugFakeScenario)}
              className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            >
              {SCENARIOS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <ControlButton
              label="Run Scenario"
              onClick={() => { void runtime.runScenario(scenario); }}
            />
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <DebugCard title="Provider">
          <DataRows rows={[
            ["Provider ID", snapshot.provider.providerId],
            ["Supported", displayAvailability(snapshot)],
            ["SpeechRecognition", yesNo(snapshot.provider.api.speechRecognition)],
            ["webkitSpeechRecognition", yesNo(snapshot.provider.api.webkitSpeechRecognition)],
            ["Constructor", value(snapshot.provider.constructorName)],
            ["Language", snapshot.provider.language],
            ["Interim Results", yesNo(snapshot.provider.interimResults)],
            ["Continuous", yesNo(snapshot.provider.continuous)],
            ["Max Alternatives", String(snapshot.provider.maxAlternatives)],
            ["Current Session ID", value(snapshot.provider.sessionId)],
            ["Provider Running", yesNo(snapshot.provider.isRunning)],
            ["Intentional Stop", optionalBoolean(snapshot.provider.intentionalStop)],
            ["Intentional Abort", optionalBoolean(snapshot.provider.intentionalAbort)],
            ["Local", `${yesNo(snapshot.provider.localSupported)} / ${snapshot.provider.localAvailabilityStatus}`],
            ["Contextual Biasing", yesNo(snapshot.provider.contextualBiasingSupported)],
            ["Starts / Ends", `${snapshot.provider.startCount} / ${snapshot.provider.endCount}`],
          ]} />
        </DebugCard>

        <DebugCard title="Voice Turn">
          <DataRows rows={[
            ["Turn ID", value(snapshot.turn.turnId)],
            ["Session ID", value(snapshot.turn.sessionId)],
            ["Status", snapshot.turn.status],
            ["Result Kind", snapshot.turn.resultKind],
            ["Turn Requested At", time(snapshot.turn.requestedAt)],
            ["Provider Started At", time(snapshot.turn.recognitionStartedAt)],
            ["Audio Started At", time(snapshot.turn.audioStartedAt)],
            ["Speech Started At", time(snapshot.turn.speechStartedAt)],
            ["Speech Ended At", time(snapshot.turn.speechEndedAt)],
            ["Provider Ended At", time(snapshot.turn.providerEndedAt)],
            ["Completed At", time(snapshot.turn.completedAt)],
            ["Stop Requested At", time(snapshot.turn.stopRequestedAt)],
            ["Cancel Requested At", time(snapshot.turn.cancelRequestedAt)],
          ]} />
        </DebugCard>
      </div>

      <DebugCard title="Transcript Debug">
        <div className="grid gap-4 lg:grid-cols-2">
          <TranscriptBlock label="Raw Interim" text={snapshot.transcript.rawInterim} />
          <TranscriptBlock label="Raw Final" text={snapshot.transcript.rawFinal} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-2 py-2">Result</th>
                <th className="px-2 py-2">Segment ID</th>
                <th className="px-2 py-2">Session</th>
                <th className="px-2 py-2">Kind</th>
                <th className="px-2 py-2">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.transcript.segments.length ? snapshot.transcript.segments.map((segment) => (
                <tr key={segment.segmentId} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">{segment.resultIndex}</td>
                  <td className="px-2 py-2 font-mono">{segment.segmentId}</td>
                  <td className="px-2 py-2 font-mono">{segment.sessionId}</td>
                  <td className="px-2 py-2">{segment.isFinal ? "Final" : "Interim"}</td>
                  <td className="px-2 py-2">{segment.text}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="px-2 py-4 text-slate-500">No segments</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DebugCard>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <DebugCard title="Frozen vs Current Context">
          <div className="mb-4 flex flex-wrap gap-2">
            <ControlButton label="Move Current Focus" onClick={() => runtime.changeCurrentFocus()} light />
            <ControlButton label="Increment Scene" onClick={() => runtime.incrementCurrentScene()} light />
            <ControlButton label="Change Page" onClick={() => runtime.changeCurrentPage()} light />
            <ControlButton label="Reset Current" onClick={() => runtime.resetCurrentContext()} light />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ContextBlock title="Frozen" context={snapshot.frozenContext} accent="cyan" />
            <ContextBlock title="Current" context={snapshot.currentContext} accent="amber" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Flag label="Page Changed" active={snapshot.contextDiff.pageChanged} />
            <Flag label="Scene Changed" active={snapshot.contextDiff.sceneChanged} />
            <Flag label="Focus Changed" active={snapshot.contextDiff.focusChanged} />
            <Flag label="Frozen Focus Stale" active={snapshot.contextDiff.frozenFocusStale} />
          </div>
        </DebugCard>

        <DebugCard title="Latency Metrics">
          <MetricRows metrics={snapshot.metrics} />
        </DebugCard>
      </div>

      <DebugCard title="Bounds Overlay (Canonical Coordinate)">
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showFrozenBounds}
              onChange={(event) => setShowFrozenBounds(event.target.checked)}
            />
            Show Frozen Focus Bounds
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showCurrentBounds}
              onChange={(event) => setShowCurrentBounds(event.target.checked)}
            />
            Show Current Focus Bounds
          </label>
        </div>
        <div className="overflow-x-auto">
          <div className="relative h-[440px] w-[900px] overflow-hidden rounded-lg border border-slate-300 bg-[linear-gradient(90deg,rgba(15,23,42,.05)_1px,transparent_1px),linear-gradient(rgba(15,23,42,.05)_1px,transparent_1px)] bg-[size:20px_20px]">
            <BoundsOverlay
              bounds={showFrozenBounds ? snapshot.frozenContext?.focusBounds : undefined}
              className="border-2 border-cyan-500 bg-cyan-300/15"
              label="Frozen"
            />
            <BoundsOverlay
              bounds={showCurrentBounds ? snapshot.currentContext?.focusBounds : undefined}
              className="border-2 border-amber-500 bg-amber-300/15"
              label="Current"
            />
          </div>
        </div>
      </DebugCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <DebugCard title="Voice Lens Position Debug">
          {snapshot.lensPosition ? <DataRows rows={[
            ["Anchor Type", snapshot.lensPosition.anchorType],
            ["Preferred Placement", snapshot.lensPosition.preferredPlacement],
            ["Anchor Screen Rect", rect(snapshot.lensPosition.anchorScreenRect)],
            ["Lens Size", size(snapshot.lensPosition.lensSize)],
            ["Safe Rect", rect(snapshot.lensPosition.safeRect)],
            ["Final Screen Position", rect(snapshot.lensPosition.finalScreenPosition)],
            ["Clamp Occurred", yesNo(snapshot.lensPosition.clampOccurred)],
            ["Fallback Reason", value(snapshot.lensPosition.fallbackReason)],
          ]} /> : <Empty label="Not measured" />}
        </DebugCard>
        <DebugCard title="Error / Completed Result">
          {snapshot.error ? <DataRows rows={[
            ["Normalized Error", snapshot.error.normalizedCode],
            ["Provider Error", value(snapshot.error.providerCode)],
            ["Recoverable", yesNo(snapshot.error.recoverable)],
            ["Intentional Abort", yesNo(snapshot.error.intentionalAbort)],
            ["Timestamp", time(snapshot.error.timestamp)],
            ["Message", value(snapshot.error.message)],
          ]} /> : snapshot.completed ? <DataRows rows={[
            ["Turn ID", snapshot.completed.id],
            ["State", snapshot.completed.state],
            ["Transcript", snapshot.completed.rawTranscript],
            ["Completed At", time(snapshot.completed.completedAt)],
            ["Scene Changed", yesNo(snapshot.completed.scene.sceneChangedDuringTurn)],
            ["Page Changed", yesNo(snapshot.completed.scene.pageChangedDuringTurn)],
          ]} /> : <Empty label="No terminal result" />}
        </DebugCard>
      </div>

      <DebugCard title={`Event Timeline (${snapshot.events.length}/200)`}>
        <div className="max-h-[34rem] overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr>
                <th className="px-2 py-2">Seq</th>
                <th className="px-2 py-2">Timestamp</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Turn / Session</th>
                <th className="px-2 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.events.map((event) => (
                <tr key={event.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-mono">{event.sequence}</td>
                  <td className="px-2 py-2 font-mono">{time(event.timestamp)}</td>
                  <td className="px-2 py-2 font-semibold">{event.type}</td>
                  <td className="px-2 py-2 font-mono">{value(event.turnId)} / {value(event.sessionId)}</td>
                  <td className="px-2 py-2">{value(event.summary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!snapshot.events.length ? <Empty label="No events" /> : null}
        </div>
      </DebugCard>

      <DebugCard title={`Recent Turn History (${snapshot.recentTurns.length}/20)`}>
        {snapshot.recentTurns.length ? (
          <ul className="space-y-2">
            {[...snapshot.recentTurns].reverse().map((turn) => (
              <li key={`${turn.turnId}:${turn.completedAt ?? turn.requestedAt}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{turn.turnId}</span>
                  <span>{turn.resultKind}</span>
                </div>
                <p className="mt-2 text-slate-700">{turn.transcript || "-"}</p>
              </li>
            ))}
          </ul>
        ) : <Empty label="No recent turns" />}
      </DebugCard>
    </div>
  );
}

function DebugCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ControlButton({ label, onClick, light = false }: {
  label: string;
  onClick: () => void;
  light?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={light
        ? "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
        : "rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 hover:border-cyan-400"}
    >
      {label}
    </button>
  );
}

function DataRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([label, content]) => (
        <div key={label} className="min-w-0 border-b border-slate-100 pb-2">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words font-mono text-slate-900">{content}</dd>
        </div>
      ))}
    </dl>
  );
}

function TranscriptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 min-h-10 whitespace-pre-wrap text-sm text-slate-900">{text || "-"}</p>
    </div>
  );
}

function ContextBlock({ title, context, accent }: {
  title: string;
  context: VoiceDebugContextSnapshot | undefined;
  accent: "cyan" | "amber";
}) {
  return (
    <div className={accent === "cyan"
      ? "rounded-lg border border-cyan-200 bg-cyan-50/50 p-3"
      : "rounded-lg border border-amber-200 bg-amber-50/50 p-3"}
    >
      <h3 className="font-semibold">{title}</h3>
      {context ? <DataRows rows={[
        ["pageId", context.pageId],
        ["sceneMode", context.sceneMode],
        ["sceneRevision", String(context.sceneRevision)],
        ["focusSource", context.focusSource],
        ["focusObjectId", value(context.focusObjectId)],
        ["focusBounds", rect(context.focusBounds)],
        ["capturedAt", time(context.capturedAt)],
      ]} /> : <Empty label="Not captured" />}
    </div>
  );
}

function Flag({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={active
      ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
      : "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600"}
    >
      <span className="block text-xs">{label}</span>
      <strong>{yesNo(active)}</strong>
    </div>
  );
}

function MetricRows({ metrics }: { metrics: VoiceDebugMetrics }) {
  return <DataRows rows={[
    ["Recognition startup", metric(metrics.recognitionStartup)],
    ["Audio ready", metric(metrics.audioReady)],
    ["Speech -> first interim", metric(metrics.speechFirstInterim)],
    ["Speech -> first final", metric(metrics.speechFirstFinal)],
    ["Final after speech end", metric(metrics.finalAfterSpeechEnd)],
    ["Speech end -> completed", metric(metrics.speechEndFinal)],
    ["Speech end -> provider end", metric(metrics.providerEnd)],
    ["Total turn", metric(metrics.totalTurn)],
  ]} />;
}

function BoundsOverlay({ bounds, className, label }: {
  bounds: VoiceDebugContextSnapshot["focusBounds"];
  className: string;
  label: string;
}) {
  const style = toVoiceDebugOverlayStyle(bounds);
  return style ? (
    <div className={`pointer-events-none absolute ${className}`} style={style}>
      <span className="absolute -top-6 left-0 rounded bg-slate-950 px-2 py-1 text-xs text-white">{label}</span>
    </div>
  ) : null;
}

function Empty({ label }: { label: string }) {
  return <p className="py-3 text-sm text-slate-500">{label}</p>;
}

function displayAvailability(snapshot: VoiceDebugSnapshot): string {
  return snapshot.provider.availabilityChecked ? yesNo(snapshot.provider.supported) : "Checking";
}

function value(input: string | undefined): string {
  return input && input.length ? input : "-";
}

function optionalBoolean(input: boolean | undefined): string {
  return input === undefined ? "-" : yesNo(input);
}

function yesNo(input: boolean): string {
  return input ? "true" : "false";
}

function time(input: number | undefined): string {
  return input === undefined ? "-" : `${input.toFixed(1)} ms`;
}

function metric(input: number | null): string {
  return input === null ? "Not measured" : `${Math.round(input).toLocaleString()} ms`;
}

function rect(input: { x: number; y: number; width: number; height: number } | undefined): string {
  return input
    ? `x:${input.x} y:${input.y} width:${input.width} height:${input.height}`
    : "-";
}

function size(input: { width: number; height: number }): string {
  return `width:${input.width} height:${input.height}`;
}

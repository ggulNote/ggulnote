import type { LayoutDetectionViewState, LayoutModelCatalog } from "../layout-detection";

type Props = { state: LayoutDetectionViewState; catalog: LayoutModelCatalog | null; selectedModelId: string; visible: boolean; canRun: boolean; onModelChange: (modelId: string) => void; onVisibleChange: (visible: boolean) => void; onRun: () => void };
const duration = (value: number | undefined): string => value === undefined ? "-" : `${value.toFixed(1)} ms`;
const fileSize = (value: number | undefined): string => value === undefined ? "-" : `${(value / 1024 / 1024).toFixed(1)} MiB`;
const tensorShape = (shape: Array<number | string | null> | undefined): string => shape?.map((dimension) => dimension ?? "?").join(" x ") ?? "-";

export function LayoutDetectionDebugPanel({ state, catalog, selectedModelId, visible, canRun, onModelChange, onVisibleChange, onRun }: Props): React.ReactElement {
  const result = state.result;
  const selectedModel = catalog?.models.find((model) => model.id === selectedModelId);
  const busy = state.status === "rendering" || state.status === "initializing" || state.status === "inferencing";
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold text-slate-900">Layout Detection PoC</h2><p className="mt-1 text-[11px] text-slate-500">Current PDF page only. No semantic fusion or cache.</p></div>
        <button type="button" className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!canRun || busy || !selectedModel} onClick={onRun}>{busy ? "Running..." : "Analyze page"}</button>
      </div>
      <label className="mt-3 grid gap-1 font-medium text-slate-800">Model
        <select className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs" value={selectedModelId} disabled={!catalog} onChange={(event) => onModelChange(event.target.value)}>
          {(catalog?.models ?? []).filter((model) => model.enabled).map((model) => <option key={model.id} value={model.id}>{model.id} ({model.variant})</option>)}
        </select>
      </label>
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={visible} onChange={(event) => onVisibleChange(event.target.checked)} />Show detection boxes</label>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
        <dt>Model ID</dt><dd className="font-mono">{selectedModel?.id ?? "-"}</dd><dt>Family</dt><dd className="font-mono">{selectedModel?.family ?? "-"}</dd><dt>Variant</dt><dd className="font-mono">{selectedModel?.variant ?? "-"}</dd><dt>ONNX size</dt><dd className="font-mono">{fileSize(selectedModel?.fileSizeBytes)}</dd>
        <dt>Status</dt><dd className="font-mono">{state.status}</dd><dt>Provider</dt><dd className="font-mono">{result?.provider ?? "-"}</dd><dt>Initialization</dt><dd className="font-mono">{duration(result?.initializationMs)}</dd><dt>Detections</dt><dd className="font-mono">{result?.detections.length ?? 0}</dd>
        <dt>Page render</dt><dd className="font-mono">{duration(result?.timings.pageRenderMs)}</dd><dt>Preprocess</dt><dd className="font-mono">{duration(result?.timings.preprocessMs)}</dd><dt>Inference</dt><dd className="font-mono">{duration(result?.timings.inferenceMs)}</dd><dt>Postprocess</dt><dd className="font-mono">{duration(result?.timings.postprocessMs)}</dd>
        <dt>Declared input</dt><dd className="font-mono">{tensorShape(selectedModel?.inputShape)}</dd><dt>Declared output</dt><dd className="font-mono">{selectedModel?.outputShapes.map(tensorShape).join(", ") ?? "-"}</dd>
        <dt>Runtime input</dt><dd className="font-mono">{result?.inputShape.join(" x ") ?? "-"}</dd><dt>Runtime output</dt><dd className="font-mono">{result?.outputShape.join(" x ") ?? "-"}</dd>
      </dl>
      {state.errorMessage ? <p className="mt-3 rounded bg-red-50 p-2 text-red-700">{state.errorMessage}</p> : null}
      {result && result.detections.length > 0 ? <ol className="mt-3 max-h-44 space-y-1 overflow-auto border-t border-slate-100 pt-3">{result.detections.slice(0, 20).map((detection) => <li key={detection.id} className="flex justify-between gap-3 font-mono"><span className="truncate">{detection.label}</span><span>{(detection.confidence * 100).toFixed(1)}%</span></li>)}</ol> : null}
    </section>
  );
}

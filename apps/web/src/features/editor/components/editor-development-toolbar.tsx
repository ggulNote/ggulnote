import { useId } from "react";
import type { EditorInteractionMode } from "../interaction/interaction-mode";

type ToolDefinition = {
  mode: EditorInteractionMode;
  label: string;
};

type Props = {
  mode: EditorInteractionMode;
  onModeChange: (mode: EditorInteractionMode) => void;
  textValue: string;
  onTextChange: (next: string) => void;
  rows: number;
  columns: number;
  onRowsChange: (next: number) => void;
  onColumnsChange: (next: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  hasDocument: boolean;
};

const TOOLS: ToolDefinition[] = [
  { mode: "select", label: "Select" },
  { mode: "text", label: "Text" },
  { mode: "underline", label: "Underline" },
  { mode: "highlight", label: "Highlight" },
  { mode: "rectangle", label: "Rectangle" },
  { mode: "ellipse", label: "Ellipse" },
  { mode: "line", label: "Line" },
  { mode: "arrow", label: "Arrow" },
  { mode: "table", label: "Table" },
];

export function EditorDevelopmentToolbar({
  mode,
  onModeChange,
  textValue,
  onTextChange,
  rows,
  columns,
  onRowsChange,
  onColumnsChange,
  onUndo,
  onRedo,
  onDelete,
  canUndo,
  canRedo,
  canDelete,
  hasDocument,
}: Props): React.ReactElement {
  const textInputId = useId();
  const rowsId = useId();
  const colsId = useId();

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="개발용 편집 도구">
      <h2 className="text-sm font-semibold">개발용 편집 도구</h2>
      <p className="text-xs text-slate-600">
        This workspace is for development only. Final service will use eye-gaze and voice commands.
      </p>
      <p className="mt-2 text-xs text-slate-600">현재 도구: {mode}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label="개발용 편집 도구">
        {TOOLS.map((tool) => (
          <button
            type="button"
            key={tool.mode}
            aria-pressed={mode === tool.mode}
            disabled={!hasDocument}
            className={`rounded border border-slate-300 px-3 py-2 text-sm ${mode === tool.mode ? "bg-slate-900 text-white" : "bg-white"}`}
            onClick={() => onModeChange(tool.mode)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        <label className="text-xs text-slate-700" htmlFor={textInputId}>
          Default text
        </label>
        <input
          id={textInputId}
          disabled={!hasDocument}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={textValue}
          onChange={(event) => onTextChange(event.currentTarget.value)}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-700" htmlFor={rowsId}>
          Table rows
          <input
            id={rowsId}
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            disabled={!hasDocument}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={rows}
            onChange={(event) => onRowsChange(Number(event.currentTarget.value))}
          />
        </label>

        <label className="text-xs text-slate-700" htmlFor={colsId}>
          Table columns
          <input
            id={colsId}
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            disabled={!hasDocument}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={columns}
            onChange={(event) => onColumnsChange(Number(event.currentTarget.value))}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canUndo || !hasDocument}
          aria-disabled={!canUndo || !hasDocument}
          onClick={onUndo}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!canRedo || !hasDocument}
          aria-disabled={!canRedo || !hasDocument}
          onClick={onRedo}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Redo
        </button>
        <button
          type="button"
          disabled={!canDelete || !hasDocument}
          aria-disabled={!canDelete || !hasDocument}
          onClick={onDelete}
          className="rounded border border-rose-300 px-3 py-2 text-sm"
        >
          Delete
        </button>
      </div>
    </section>
  );
}

import { useId } from "react";
import type { EditorInteractionMode } from "../interaction/interaction-mode";

type ToolDefinition = {
  mode: EditorInteractionMode;
  label: string;
};

type FontWeight = "normal" | "bold";

type Props = {
  mode: EditorInteractionMode;
  onModeChange: (mode: EditorInteractionMode) => void;
  textValue: string;
  onTextChange: (next: string) => void;
  rows: number;
  columns: number;
  onRowsChange: (next: number) => void;
  onColumnsChange: (next: number) => void;
  onStrokeColorChange: (next: string) => void;
  onFillColorChange: (next: string) => void;
  onFillEnabledChange: (next: boolean) => void;
  onShapeStrokeWidthChange: (next: number) => void;
  onLineStrokeWidthChange: (next: number) => void;
  onUnderlineThicknessChange: (next: number) => void;
  onTableStrokeWidthChange: (next: number) => void;
  onTextColorChange: (next: string) => void;
  onTextFontSizeChange: (next: number) => void;
  onTextFontFamilyChange: (next: string) => void;
  onTextFontWeightChange: (next: FontWeight) => void;
  onHighlightColorChange: (next: string) => void;
  onHighlightOpacityChange: (next: number) => void;
  textFontSize: number;
  textFontFamily: string;
  textFontWeight: FontWeight;
  strokeColor: string;
  shapeFillColor: string;
  shapeStrokeWidth: number;
  lineStrokeWidth: number;
  underlineThickness: number;
  tableStrokeWidth: number;
  textColor: string;
  shapeFilled: boolean;
  highlightColor: string;
  highlightOpacity: number;
  canApplyToSelected: boolean;
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

const FONT_FAMILIES = ["Arial", "Times New Roman", "Georgia", "Courier New", "Verdana"] as const;

export function EditorDevelopmentToolbar({
  mode,
  onModeChange,
  textValue,
  onTextChange,
  rows,
  columns,
  onRowsChange,
  onColumnsChange,
  onStrokeColorChange,
  onFillColorChange,
  onFillEnabledChange,
  onShapeStrokeWidthChange,
  onLineStrokeWidthChange,
  onUnderlineThicknessChange,
  onTableStrokeWidthChange,
  onTextColorChange,
  onTextFontSizeChange,
  onTextFontFamilyChange,
  onTextFontWeightChange,
  onHighlightColorChange,
  onHighlightOpacityChange,
  textFontSize,
  textFontFamily,
  textFontWeight,
  strokeColor,
  shapeFillColor,
  shapeStrokeWidth,
  lineStrokeWidth,
  underlineThickness,
  tableStrokeWidth,
  textColor,
  shapeFilled,
  highlightColor,
  highlightOpacity,
  canApplyToSelected,
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
  const strokeColorId = useId();
  const fillColorId = useId();
  const textColorId = useId();
  const shapeStrokeId = useId();
  const lineStrokeId = useId();
  const underlineThicknessId = useId();
  const tableStrokeId = useId();
  const fontSizeId = useId();
  const fontFamilyId = useId();
  const highlightColorId = useId();

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

      <div className="mt-3 rounded border border-slate-200 p-2">
        <h3 className="text-xs font-semibold text-slate-700">공통 속성</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-700" htmlFor={strokeColorId}>
            선 색상
            <input
              id={strokeColorId}
              type="color"
              className="mt-1 block w-full rounded border border-slate-300"
              disabled={!hasDocument}
              value={strokeColor}
              onChange={(event) => onStrokeColorChange(event.currentTarget.value)}
            />
          </label>

          <div className="text-xs text-slate-700">
            텍스트 색상
            <input
              type="color"
              className="mt-1 block w-full rounded border border-slate-300"
              disabled={!hasDocument}
              value={textColor}
              onChange={(event) => onTextColorChange(event.currentTarget.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-200 p-2">
        <h3 className="text-xs font-semibold text-slate-700">텍스트 스타일</h3>
        <div className="mt-2 grid gap-2">
          <label className="text-xs text-slate-700" htmlFor={fontSizeId}>
            글자 크기
            <input
              id={fontSizeId}
              type="number"
              inputMode="numeric"
              min={8}
              max={120}
              step={1}
              disabled={!hasDocument}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={textFontSize}
              onChange={(event) => onTextFontSizeChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="text-xs text-slate-700" htmlFor={fontFamilyId}>
            폰트
            <select
              id={fontFamilyId}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={textFontFamily}
              disabled={!hasDocument}
              onChange={(event) => onTextFontFamilyChange(event.currentTarget.value)}
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-700">
            굵게
            <button
              type="button"
              className={`mt-1 block w-full rounded border px-2 py-1 text-sm ${textFontWeight === "bold" ? "bg-slate-900 text-white" : "bg-white"}`}
              disabled={!hasDocument}
              onClick={() => onTextFontWeightChange(textFontWeight === "bold" ? "normal" : "bold")}
            >
              {textFontWeight === "bold" ? "Bold" : "Normal"}
            </button>
          </label>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-200 p-2">
        <h3 className="text-xs font-semibold text-slate-700">도형 / 라인 / 테이블</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-700" htmlFor={shapeStrokeId}>
            도형 선 굵기
            <input
              id={shapeStrokeId}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              disabled={!hasDocument}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={shapeStrokeWidth}
              onChange={(event) => onShapeStrokeWidthChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="text-xs text-slate-700" htmlFor={lineStrokeId}>
            라인 선 굵기
            <input
              id={lineStrokeId}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              disabled={!hasDocument}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={lineStrokeWidth}
              onChange={(event) => onLineStrokeWidthChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="text-xs text-slate-700" htmlFor={underlineThicknessId}>
            Underline 굵기
            <input
              id={underlineThicknessId}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              disabled={!hasDocument}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={underlineThickness}
              onChange={(event) => onUnderlineThicknessChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="text-xs text-slate-700" htmlFor={tableStrokeId}>
            Table 선 굵기
            <input
              id={tableStrokeId}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              disabled={!hasDocument}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={tableStrokeWidth}
              onChange={(event) => onTableStrokeWidthChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="text-xs text-slate-700" htmlFor={fillColorId}>
            도형 채우기 색상
            <input
              id={fillColorId}
              type="color"
              className="mt-1 block w-full rounded border border-slate-300"
              disabled={!hasDocument}
              value={shapeFillColor}
              onChange={(event) => onFillColorChange(event.currentTarget.value)}
            />
          </label>

          <label className="text-xs text-slate-700">
            도형 채우기
            <button
              type="button"
              className={`mt-1 block w-full rounded border px-2 py-1 text-sm ${shapeFilled ? "bg-slate-900 text-white" : "bg-white"}`}
              disabled={!hasDocument}
              onClick={() => onFillEnabledChange(!shapeFilled)}
            >
              {shapeFilled ? "On" : "Off"}
            </button>
          </label>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-200 p-2">
        <h3 className="text-xs font-semibold text-slate-700">Highlight</h3>
        <div className="mt-2 grid gap-2">
          <label className="text-xs text-slate-700" htmlFor={highlightColorId}>
            색상
            <input
              id={highlightColorId}
              type="color"
              className="mt-1 block w-full rounded border border-slate-300"
              disabled={!hasDocument}
              value={highlightColor}
              onChange={(event) => onHighlightColorChange(event.currentTarget.value)}
            />
          </label>

          <label className="text-xs text-slate-700">
            불투명도: {Math.round(highlightOpacity * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={!hasDocument}
              className="mt-1 block w-full"
              value={highlightOpacity}
              onChange={(event) => onHighlightOpacityChange(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-600">선택한 어노테이션이 있으면 함께 적용됨: {canApplyToSelected ? "ON" : "OFF"}</p>

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

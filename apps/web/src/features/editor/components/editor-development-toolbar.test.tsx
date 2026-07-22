import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDevelopmentToolbar } from "./editor-development-toolbar";
import type { EditorInteractionMode } from "../interaction/interaction-mode";

afterEach(cleanup);

const noOp = (): void => undefined;

const defaultProps: ComponentProps<typeof EditorDevelopmentToolbar> = {
  mode: "select",
  onModeChange: noOp,
  textValue: "memo",
  onTextChange: noOp,
  rows: 3,
  columns: 3,
  onRowsChange: noOp,
  onColumnsChange: noOp,
  onStrokeColorChange: noOp,
  onFillColorChange: noOp,
  onFillEnabledChange: noOp,
  onShapeStrokeWidthChange: noOp,
  onLineStrokeWidthChange: noOp,
  onUnderlineThicknessChange: noOp,
  onTableStrokeWidthChange: noOp,
  onTextColorChange: noOp,
  onTextFontSizeChange: noOp,
  onTextFontFamilyChange: noOp,
  onTextFontWeightChange: noOp,
  onHighlightColorChange: noOp,
  onHighlightOpacityChange: noOp,
  textFontSize: 14,
  textFontFamily: "Arial",
  textFontWeight: "normal",
  strokeColor: "#1f2937",
  shapeFillColor: "#facc15",
  shapeStrokeWidth: 2,
  lineStrokeWidth: 2,
  underlineThickness: 2,
  tableStrokeWidth: 1,
  textColor: "#111827",
  shapeFilled: false,
  highlightColor: "#facc15",
  highlightOpacity: 0.35,
  canApplyToSelected: false,
  onUndo: noOp,
  onRedo: noOp,
  onDelete: noOp,
  canUndo: false,
  canRedo: false,
  canDelete: false,
  hasDocument: true,
};

describe("EditorDevelopmentToolbar", () => {
  it("renders mode buttons with aria-pressed and calls mode change", () => {
    const calls: EditorInteractionMode[] = [];

    render(
      <EditorDevelopmentToolbar
        {...defaultProps}
        mode="text"
        onModeChange={(mode) => calls.push(mode)}
        canUndo
        canRedo
      />,
    );

    const rectangleButton = screen.getByRole("button", { name: "Rectangle" });
    expect(rectangleButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(rectangleButton);
    expect(calls).toEqual(["rectangle"]);

    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(selectButton).toHaveAttribute("aria-pressed", "false");
  });

  it("disables actions when document is unavailable", () => {
    render(
      <EditorDevelopmentToolbar
        {...defaultProps}
        hasDocument={false}
      />,
    );

    const toolbar = screen
      .getByRole("heading", { name: "개발용 편집 도구" })
      .closest("section");

    if (!toolbar) {
      throw new Error("Editor development toolbar section was not found");
    }

    expect(within(toolbar).getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: "Text" })).toBeDisabled();
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorDevelopmentToolbar } from "./editor-development-toolbar";
import type { EditorInteractionMode } from "../interaction/interaction-mode";

describe("EditorDevelopmentToolbar", () => {
  it("renders mode buttons with aria-pressed and calls mode change", () => {
    const calls: EditorInteractionMode[] = [];

    render(
      <EditorDevelopmentToolbar
        mode="text"
        onModeChange={(mode) => calls.push(mode)}
        textValue="memo"
        onTextChange={() => undefined}
        rows={3}
        columns={3}
        onRowsChange={() => undefined}
        onColumnsChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onDelete={() => undefined}
        canUndo
        canRedo
        canDelete={false}
        hasDocument
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
        mode="select"
        onModeChange={() => undefined}
        textValue="memo"
        onTextChange={() => undefined}
        rows={3}
        columns={3}
        onRowsChange={() => undefined}
        onColumnsChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onDelete={() => undefined}
        canUndo={false}
        canRedo={false}
        canDelete={false}
        hasDocument={false}
      />,
    );

    const getButtonByLabel = (panel: HTMLElement, label: string): HTMLButtonElement | null => {
      const button = Array.from(panel.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === label,
      );

      return button instanceof HTMLButtonElement ? button : null;
    };

    const toolbar = screen
      .getAllByRole("section")
      .find((section) => {
        const labels = ["Select", "Text", "Underline", "Highlight", "Rectangle", "Ellipse", "Line", "Arrow", "Table", "Undo", "Redo", "Delete"];
        const sectionButtons = Array.from(section.querySelectorAll("button"));

        return labels.every((label) => sectionButtons.some((button) => button.textContent?.trim() === label));
      });

    expect(toolbar).toBeDefined();

    const resolvedToolbar = toolbar as HTMLElement;
    const undoButton = getButtonByLabel(resolvedToolbar, "Undo");
    const redoButton = getButtonByLabel(resolvedToolbar, "Redo");

    expect(undoButton).toBeTruthy();
    expect(redoButton).toBeTruthy();
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
    expect(within(resolvedToolbar).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(resolvedToolbar).getByRole("button", { name: "Text" })).toBeDisabled();
  });
});

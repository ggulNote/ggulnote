import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorDebugPanel } from "./editor-debug-panel";
import type { EditorSnapshot, SerializedAnnotation } from "@ggulnote/editor-core";

describe("EditorDebugPanel", () => {
  it("renders snapshot state and selected annotation type", () => {
    const snapshot: EditorSnapshot = {
      documentId: "doc-1",
      activePageId: "page-1",
      selectedAnnotationId: "ann-1",
      annotationCount: 3,
      canUndo: true,
      canRedo: false,
      lastOperation: {
        operationId: "op-1",
        documentId: "doc-1",
        pageId: "page-1",
        annotationId: "ann-1",
        type: "CREATE_ANNOTATION",
        payload: null,
        createdAt: 1,
      },
      revision: 10,
    };

    const selected: SerializedAnnotation = {
      schemaVersion: 1,
      id: "ann-1",
      pageId: "page-1",
      type: "TEXT",
      bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
      zIndex: 1,
      properties: {
        text: "memo",
        fontSize: 12,
        textAlign: "left",
      },
      createdAt: 10,
      updatedAt: 20,
    };

    render(
      <EditorDebugPanel
        editorSnapshot={snapshot}
        interactionMode="text"
        pageSize={{ width: 100, height: 200 }}
        canvasWidth={100}
        canvasHeight={200}
        dpr={2}
        pointer={{ x: 0.1, y: 0.2 }}
        selectedAnnotation={selected}
        undoStackSize={1}
        redoStackSize={0}
      />,
    );

    expect(screen.getByText("doc-1")).toBeInTheDocument();
    expect(screen.getByText("page-1")).toBeInTheDocument();
    expect(screen.getByText("Selected annotation type")).toBeInTheDocument();
    expect(screen.getByText("TEXT")).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('"memo"')),
    ).toBeInTheDocument();
  });
});

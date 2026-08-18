import { afterEach, describe, expect, it } from "vitest";
import {
  compileMathRenderDelete,
  compileMathRenderUpsert,
  createMathExpression,
} from "@ggulnote/math-core";
import {
  Editor,
  createTLStore,
  defaultAddFontsFromNode,
  defaultBindingUtils,
  defaultShapeUtils,
  tipTapDefaultExtensions,
  type TLAnyShapeUtilConstructor,
  type TLShapeId,
} from "tldraw";
import { MathObjectShapeUtil } from "./math-object-shape";
import { NoteAnnotationShapeUtil } from "./note-annotation-shape";
import { TldrawEditorAdapter } from "./tldraw-editor-adapter";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
});

describe("TldrawEditorAdapter", () => {
  it("projects built-in text and one logical multi-segment annotation", () => {
    const { editor, adapter } = createAdapter();
    const committed = adapter.applyPreparedOperations({
      turnId: "turn-1",
      operations: [
        {
          kind: "CREATE_TEXT",
          text: "안녕하세요",
          bounds: { x: 60, y: 80, width: 180, height: 40 },
        },
        {
          kind: "CREATE_ANNOTATION",
          annotationType: "underline",
          rects: [
            { x: 100, y: 200, width: 120, height: 4 },
            { x: 100, y: 216, width: 200, height: 4 },
          ],
        },
      ],
    });
    editor.setSelectedShapes([committed.createdObjectIds[0] as TLShapeId]);

    expect(adapter.getCurrentPageObjects()).toEqual([
      expect.objectContaining({
        objectId: committed.createdObjectIds[0],
        kind: "text",
        text: "안녕하세요",
        normalizedBounds: expect.objectContaining({ x: 0.1, y: 0.1 }),
        selected: true,
        createdByTurnId: "turn-1",
      }),
      expect.objectContaining({
        objectId: committed.createdObjectIds[1],
        kind: "annotation",
        annotationType: "underline",
        selected: false,
        rects: [
          { x: 100, y: 200, width: 120, height: 4 },
          { x: 100, y: 216, width: 200, height: 4 },
        ],
      }),
    ]);
    expect(adapter.exportPageProjection().annotations).toHaveLength(2);
    expect(adapter.exportPageProjection().annotations[1]).toMatchObject({
      type: "UNDERLINE",
      rects: [
        { x: 1 / 6, y: 0.25, width: 0.2, height: 0.005 },
        { x: 1 / 6, y: 0.27, width: 1 / 3, height: 0.005 },
      ],
    });
  });

  it("commits multiple operations as one history unit and rolls back a child failure", () => {
    const { adapter } = createAdapter();
    adapter.applyPreparedOperations({
      turnId: "turn-atomic",
      operations: [
        { kind: "CREATE_TEXT", text: "one", bounds: { x: 20, y: 20, width: 100, height: 30 } },
        { kind: "CREATE_TEXT", text: "two", bounds: { x: 20, y: 80, width: 100, height: 30 } },
      ],
    });
    expect(adapter.getCurrentPageObjects()).toHaveLength(2);
    expect(adapter.undo()).toBe(true);
    expect(adapter.getCurrentPageObjects()).toHaveLength(0);

    expect(() => adapter.applyPreparedOperations({
      turnId: "turn-fail",
      operations: [
        { kind: "CREATE_TEXT", text: "must rollback", bounds: { x: 20, y: 20, width: 100, height: 30 } },
        { kind: "REPLACE_TEXT", objectId: "shape:missing", text: "failure" },
      ],
    })).toThrow(/does not exist/u);
    expect(adapter.getCurrentPageObjects()).toHaveLength(0);
  });

  it("roundtrips TLStore content, bounds, and metadata through a versioned snapshot", () => {
    const first = createAdapter();
    first.adapter.applyPreparedOperations({
      turnId: "turn-persist",
      operations: [{
        kind: "CREATE_TEXT",
        text: "persist me",
        bounds: { x: 120, y: 240, width: 160, height: 40 },
      }],
    });
    const snapshot = first.adapter.snapshot();

    const second = createAdapter();
    second.adapter.load(snapshot);
    expect(second.adapter.getCurrentPageObjects()).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "persist me",
        bounds: expect.objectContaining({ x: 120, y: 240 }),
        createdByTurnId: "turn-persist",
      }),
    ]);
  });

  it("exposes the independent math render hook without projecting it as a legacy annotation", () => {
    const { editor, adapter } = createAdapter();
    const expression = createMathExpression({
      bounds: { x: 40, y: 50, width: 180, height: 60 },
      content: { source: "y=x^2", format: "plain" },
    }, "expression-runtime-1");

    const created = adapter.applyMathRenderOperation(compileMathRenderUpsert(expression));
    expect(created.change).toBe("created");
    expect(editor.getShape(created.shapeId)).toMatchObject({ type: "ggulnote-math", x: 40, y: 50 });
    expect(adapter.getCurrentPageObjects()).toEqual([]);
    expect(adapter.exportPageProjection().annotations).toEqual([]);

    expect(adapter.applyMathRenderOperation(compileMathRenderDelete(expression.id)).change).toBe("deleted");
    expect(editor.getShape(created.shapeId)).toBeUndefined();
  });
});

function createAdapter(): { editor: Editor; adapter: TldrawEditorAdapter } {
  const shapeUtils: readonly TLAnyShapeUtilConstructor[] = [
    ...defaultShapeUtils,
    NoteAnnotationShapeUtil,
    MathObjectShapeUtil,
  ];
  const store = createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils });
  const editor = new Editor({
    store,
    shapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => document.body,
    options: {
      text: {
        addFontsFromNode: defaultAddFontsFromNode,
        tipTapConfig: { extensions: tipTapDefaultExtensions },
      },
    },
  });
  editors.push(editor);
  return {
    editor,
    adapter: new TldrawEditorAdapter(
      editor,
      "doc-1",
      "page-1",
      1,
      { width: 600, height: 800 },
      () => 123,
    ),
  };
}

import { afterEach, describe, expect, it } from "vitest";
import {
  compileMathRenderDelete,
  compileMathRenderUpsert,
  createMathTable,
  parseMathObject,
  serializeMathObject,
  setMathTableCell,
} from "@ggulnote/math-core";
import {
  Editor,
  createTLStore,
  defaultAddFontsFromNode,
  defaultBindingUtils,
  defaultShapeUtils,
  tipTapDefaultExtensions,
  type TLAnyShapeUtilConstructor,
} from "tldraw";
import {
  MathObjectShapeUtil,
  toMathShapeVisualModel,
  type MathObjectShape,
} from "./math-object-shape";
import { TldrawMathRenderAdapter } from "./tldraw-math-render-adapter";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
});

describe("TldrawMathRenderAdapter", () => {
  it("creates, updates, moves, and deletes one custom shape per logical math object", () => {
    const { editor, adapter } = createAdapter();
    const table = createMathTable({
      objectId: "table-logical-1",
      bounds: { x: 80, y: 120, width: 240, height: 100 },
      rows: 2,
      columns: 2,
      initialValues: [["x", "y"], ["1", "2"]],
      headerRows: [0],
    }, "table-logical-1");

    const created = adapter.apply(compileMathRenderUpsert(table));
    const firstShape = editor.getShape<MathObjectShape>(created.shapeId);
    expect(created.change).toBe("created");
    expect(firstShape).toMatchObject({
      type: "ggulnote-math",
      x: 80,
      y: 120,
      props: {
        w: 240,
        h: 100,
        logicalObjectId: table.id,
        objectKind: "table",
      },
    });
    if (firstShape === undefined) throw new Error("Expected math shape.");
    expect(toMathShapeVisualModel(firstShape.props).primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: "x" }),
    ]));

    const updatedTable = setMathTableCell({
      ...table,
      bounds: { x: 100, y: 150, width: 260, height: 120 },
    }, {
      objectId: table.id,
      row: 1,
      column: 1,
      value: "3",
    });
    const updated = adapter.apply(compileMathRenderUpsert(updatedTable));
    const updatedShape = editor.getShape<MathObjectShape>(updated.shapeId);
    expect(updated).toMatchObject({ shapeId: created.shapeId, change: "updated" });
    expect(updatedShape).toMatchObject({ x: 100, y: 150, props: { w: 260, h: 120 } });
    if (updatedShape === undefined) throw new Error("Expected updated math shape.");
    const restored = parseMathObject(updatedShape.props.serializedObject);
    expect(restored.kind).toBe("table");
    if (restored.kind !== "table") return;
    expect(restored.cells[1]![1]!.value).toBe("3");
    expect(editor.getCurrentPageShapes()).toHaveLength(1);

    expect(adapter.apply(compileMathRenderDelete(table.id)).change).toBe("deleted");
    expect(editor.getCurrentPageShapes()).toHaveLength(0);
    expect(adapter.apply(compileMathRenderDelete(table.id)).change).toBe("unchanged");
  });

  it("rejects a serialized object that disagrees with the shape identity", () => {
    const table = createMathTable({
      bounds: { x: 0, y: 0, width: 100, height: 60 },
      rows: 1,
      columns: 1,
    }, "table-a");
    const shapeProps: MathObjectShape["props"] = {
      w: 100,
      h: 60,
      logicalObjectId: "table-b",
      objectKind: "table",
      serializedObject: JSON.stringify(serializeMathObject(table)),
    };
    expect(() => toMathShapeVisualModel(shapeProps)).toThrow("do not match");
  });
});

function createAdapter(): { editor: Editor; adapter: TldrawMathRenderAdapter } {
  const shapeUtils: readonly TLAnyShapeUtilConstructor[] = [
    ...defaultShapeUtils,
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
  return { editor, adapter: new TldrawMathRenderAdapter(editor) };
}

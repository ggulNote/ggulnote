import type { Rect } from "@ggulnote/shared-types";
import type {
  ArithmeticCursor,
  ArithmeticRow,
  MathExpression,
  MathExpressionContent,
  MathExpressionNode,
  MathGraphFunction,
  MathGraphHelperLine,
  MathObjectStyle,
  MathShapeGeometry,
  MathShapePreset,
  MathShapeType,
  MathTableCell,
} from "../domain/math-object";

export interface MathCreateBaseInput {
  readonly objectId?: string;
  readonly bounds: Rect;
  readonly style?: MathObjectStyle;
  readonly label?: string;
}

export interface CreateMathExpressionInput extends MathCreateBaseInput {
  readonly content: MathExpressionContent;
  readonly displayMode?: MathExpression["displayMode"];
  readonly alignment?: MathExpression["alignment"];
  readonly editable?: boolean;
}

export interface UpdateMathExpressionInput {
  readonly objectId: string;
  readonly patch: Partial<
    Pick<MathExpression, "content" | "displayMode" | "alignment" | "editable" | "label" | "style">
  >;
}

export interface InsertMathExpressionNodeInput {
  readonly objectId: string;
  /** Child indices from the expression root to the insertion position. */
  readonly path: readonly number[];
}

export interface CreateMathTableInput extends MathCreateBaseInput {
  readonly tableType?: "general" | "function_values" | "xy_values";
  readonly rows: number;
  readonly columns: number;
  readonly initialValues?: readonly (readonly string[])[];
  readonly headerRows?: readonly number[];
  readonly headerColumns?: readonly number[];
}

export interface SetMathTableCellInput {
  readonly objectId: string;
  readonly row: number;
  readonly column: number;
  readonly value: string;
  readonly alignment?: MathTableCell["alignment"];
}

export interface AddMathTableRowInput {
  readonly objectId: string;
  readonly atIndex?: number;
  readonly values?: readonly string[];
}

export interface AddMathTableColumnInput {
  readonly objectId: string;
  readonly atIndex?: number;
  readonly values?: readonly string[];
}

export interface CreateMathGraphInput extends MathCreateBaseInput {
  readonly functions: readonly MathGraphFunction[];
  readonly viewport?: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
  readonly showAxes?: boolean;
  readonly showGrid?: boolean;
}

export interface AddMathGraphPointInput {
  readonly objectId: string;
  readonly pointId?: string;
  readonly x: number;
  readonly y: number;
  readonly label?: string;
  readonly functionIds?: readonly string[];
}

export interface AddMathGraphTangentInput {
  readonly objectId: string;
  readonly tangentId?: string;
  readonly functionId: string;
  readonly atX: number;
  readonly label?: string;
}

export interface AddMathGraphHelperLineInput {
  readonly objectId: string;
  readonly helperLine: MathGraphHelperLine;
}

export interface LabelMathGraphPointInput {
  readonly objectId: string;
  readonly pointId: string;
  readonly label: string;
}

export interface CreateMathShapeInput extends MathCreateBaseInput {
  readonly shapeType: MathShapeType;
  readonly preset?: MathShapePreset;
  readonly geometry: MathShapeGeometry;
}

export interface LabelMathShapeVertexInput {
  readonly objectId: string;
  readonly vertexIndex: number;
  readonly label: string;
}

export interface MarkMathShapeInput {
  readonly objectId: string;
  readonly targetIndices: readonly number[];
  readonly value?: string;
}

export interface SetupArithmeticInput extends MathCreateBaseInput {
  readonly operands: readonly string[];
}

export interface WriteArithmeticDigitInput {
  readonly objectId: string;
  readonly rowId: string;
  readonly column: number;
  readonly value: string;
}

export interface WriteArithmeticCarryInput {
  readonly objectId: string;
  readonly column: number;
  readonly value: string;
  readonly sourceRowId?: string;
}

export interface WriteArithmeticPartialRowInput {
  readonly objectId: string;
  readonly rowId?: string;
  readonly values: readonly string[];
  readonly offsetColumns?: number;
}

export interface DrawArithmeticSeparatorInput {
  readonly objectId: string;
  readonly afterRowId: string;
  readonly lineStyle?: "solid" | "dashed";
}

export interface AdvanceArithmeticCursorInput {
  readonly objectId: string;
  readonly cursor?: ArithmeticCursor;
  readonly rowDelta?: number;
  readonly columnDelta?: number;
}

export interface AddArithmeticRowInput {
  readonly objectId: string;
  readonly row: ArithmeticRow;
}

export interface MathActionInputMap {
  readonly "math.expression.create": CreateMathExpressionInput;
  readonly "math.expression.update": UpdateMathExpressionInput;
  readonly "math.expression.insert_fraction": InsertMathExpressionNodeInput & {
    readonly numerator: MathExpressionNode;
    readonly denominator: MathExpressionNode;
  };
  readonly "math.expression.insert_power": InsertMathExpressionNodeInput & {
    readonly base: MathExpressionNode;
    readonly exponent: MathExpressionNode;
  };
  readonly "math.expression.insert_root": InsertMathExpressionNodeInput & {
    readonly radicand: MathExpressionNode;
    readonly index?: MathExpressionNode;
  };
  readonly "math.table.create": CreateMathTableInput;
  readonly "math.table.set_cell": SetMathTableCellInput;
  readonly "math.table.add_row": AddMathTableRowInput;
  readonly "math.table.add_column": AddMathTableColumnInput;
  readonly "math.graph.create": CreateMathGraphInput;
  readonly "math.graph.add_point": AddMathGraphPointInput;
  readonly "math.graph.add_tangent": AddMathGraphTangentInput;
  readonly "math.graph.add_helper_line": AddMathGraphHelperLineInput;
  readonly "math.graph.label_point": LabelMathGraphPointInput;
  readonly "math.shape.create": CreateMathShapeInput;
  readonly "math.shape.create_line": CreateMathShapeInput;
  readonly "math.shape.create_triangle": CreateMathShapeInput;
  readonly "math.shape.create_rectangle": CreateMathShapeInput;
  readonly "math.shape.create_circle": CreateMathShapeInput;
  readonly "math.shape.create_polygon": CreateMathShapeInput;
  readonly "math.shape.label_vertex": LabelMathShapeVertexInput;
  readonly "math.shape.mark_angle": MarkMathShapeInput;
  readonly "math.shape.mark_parallel": MarkMathShapeInput;
  readonly "math.shape.mark_perpendicular": MarkMathShapeInput;
  readonly "math.arithmetic.setup_vertical_add": SetupArithmeticInput;
  readonly "math.arithmetic.setup_vertical_subtract": SetupArithmeticInput;
  readonly "math.arithmetic.setup_vertical_multiply": SetupArithmeticInput;
  readonly "math.arithmetic.write_digit": WriteArithmeticDigitInput;
  readonly "math.arithmetic.write_carry": WriteArithmeticCarryInput;
  readonly "math.arithmetic.write_partial_row": WriteArithmeticPartialRowInput;
  readonly "math.arithmetic.draw_separator": DrawArithmeticSeparatorInput;
  readonly "math.arithmetic.advance_cursor": AdvanceArithmeticCursorInput;
  readonly "math.arithmetic.add_row": AddArithmeticRowInput;
}

export type MathActionId = keyof MathActionInputMap;

export interface MathAction<TActionId extends MathActionId> {
  readonly id: TActionId;
  readonly input: MathActionInputMap[TActionId];
}

export type AnyMathAction = {
  readonly [TActionId in MathActionId]: MathAction<TActionId>;
}[MathActionId];

export const createMathAction = <TActionId extends MathActionId>(
  id: TActionId,
  input: MathActionInputMap[TActionId],
): MathAction<TActionId> => ({ id, input });

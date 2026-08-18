import type { Point, Rect } from "@ggulnote/shared-types";

export type { Point, Rect } from "@ggulnote/shared-types";

export type MathObjectKind =
  | "expression"
  | "table"
  | "graph"
  | "shape"
  | "arithmetic_layout";

export type MathMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly MathMetadataValue[]
  | { readonly [key: string]: MathMetadataValue };

export interface MathObjectStyle {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineStyle?: "solid" | "dashed" | "dotted";
  /** Rendering hint only. Geometry stays deterministic. */
  readonly handDrawn?: boolean;
}

export interface MathObjectChild {
  readonly id: string;
  readonly kind: string;
}

export interface BaseMathObject {
  readonly id: string;
  readonly kind: MathObjectKind;
  readonly bounds: Rect;
  readonly style: MathObjectStyle;
  readonly label?: string;
  readonly metadata: Readonly<Record<string, MathMetadataValue>>;
  readonly children: readonly MathObjectChild[];
}

export type MathExpressionNode =
  | {
      readonly type: "text";
      readonly value: string;
    }
  | {
      readonly type: "sequence";
      readonly items: readonly MathExpressionNode[];
    }
  | {
      readonly type: "fraction";
      readonly numerator: MathExpressionNode;
      readonly denominator: MathExpressionNode;
    }
  | {
      readonly type: "power";
      readonly base: MathExpressionNode;
      readonly exponent: MathExpressionNode;
    }
  | {
      readonly type: "subscript";
      readonly base: MathExpressionNode;
      readonly subscript: MathExpressionNode;
    }
  | {
      readonly type: "root";
      readonly radicand: MathExpressionNode;
      readonly index?: MathExpressionNode;
    }
  | {
      readonly type: "group";
      readonly opening: "(" | "[" | "{";
      readonly closing: ")" | "]" | "}";
      readonly content: MathExpressionNode;
    }
  | {
      readonly type: "equation";
      readonly left: MathExpressionNode;
      readonly right: MathExpressionNode;
      readonly operator: "=" | "<" | ">" | "≤" | "≥" | "≠";
    }
  | {
      readonly type: "system";
      readonly equations: readonly MathExpressionNode[];
    };

export interface MathExpressionContent {
  /** Editable display fallback. It is not evaluated by math-core. */
  readonly source: string;
  readonly format: "plain" | "latex" | "structured";
  readonly root?: MathExpressionNode;
}

export interface MathExpression extends BaseMathObject {
  readonly kind: "expression";
  readonly content: MathExpressionContent;
  readonly displayMode: "inline" | "block" | "equation_stack";
  readonly alignment: "left" | "center" | "right";
  readonly editable: boolean;
}

export interface MathTableCell {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly value: string;
  readonly alignment?: "left" | "center" | "right";
}

export interface MathTable extends BaseMathObject {
  readonly kind: "table";
  readonly tableType: "general" | "function_values" | "xy_values";
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cells: readonly (readonly MathTableCell[])[];
  readonly headerRows: readonly number[];
  readonly headerColumns: readonly number[];
  readonly defaultCellAlignment: "left" | "center" | "right";
}

export interface MathInterval {
  readonly min: number;
  readonly max: number;
  readonly includeMin: boolean;
  readonly includeMax: boolean;
}

export type MathGraphFunctionType =
  | "linear"
  | "quadratic"
  | "cubic"
  | "quartic"
  | "absolute"
  | "rational"
  | "radical"
  | "exponential"
  | "logarithmic"
  | "sin"
  | "cos"
  | "tan"
  | "circle"
  | "ellipse"
  | "hyperbola"
  | "custom";

export interface MathGraphFunction {
  readonly id: string;
  readonly functionType: MathGraphFunctionType;
  /** Human-readable source such as y=2x+1. */
  readonly expression: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly domain?: MathInterval;
  readonly style?: MathObjectStyle;
  readonly label?: string;
}

export interface MathCoordinateSystem {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly xStep: number;
  readonly yStep: number;
  readonly showAxes: boolean;
  readonly showGrid: boolean;
  readonly xLabel?: string;
  readonly yLabel?: string;
}

export interface MathGraphPoint {
  readonly id: string;
  readonly position: Point;
  readonly label?: string;
  readonly role: "user" | "intersection" | "extremum" | "reference";
  readonly functionIds: readonly string[];
}

export interface MathGraphTangent {
  readonly id: string;
  readonly functionId: string;
  readonly atX: number;
  readonly point: Point;
  readonly slope: number;
  readonly label?: string;
}

export interface MathGraphHelperLine {
  readonly id: string;
  readonly helperType: "vertical" | "horizontal" | "axis_guides" | "segment";
  readonly start: Point;
  readonly end: Point;
  readonly lineStyle: "solid" | "dashed" | "dotted";
  readonly label?: string;
}

export interface MathGraphLabel {
  readonly id: string;
  readonly text: string;
  readonly position: Point;
  readonly targetId?: string;
}

export interface MathGraph extends BaseMathObject {
  readonly kind: "graph";
  readonly coordinateSystem: MathCoordinateSystem;
  readonly functions: readonly MathGraphFunction[];
  readonly points: readonly MathGraphPoint[];
  readonly tangents: readonly MathGraphTangent[];
  readonly helperLines: readonly MathGraphHelperLine[];
  readonly labels: readonly MathGraphLabel[];
}

export type MathShapeType =
  | "point"
  | "segment"
  | "line"
  | "ray"
  | "angle"
  | "triangle"
  | "quadrilateral"
  | "rectangle"
  | "square"
  | "parallelogram"
  | "rhombus"
  | "trapezoid"
  | "circle"
  | "sector"
  | "arc"
  | "polygon";

export type MathShapePreset =
  | "equilateral"
  | "isosceles"
  | "right_triangle"
  | "rectangle"
  | "square"
  | "parallelogram"
  | "rhombus"
  | "trapezoid";

export type MathShapeGeometry =
  | {
      readonly kind: "point";
      readonly point: Point;
    }
  | {
      readonly kind: "linear";
      readonly start: Point;
      readonly end: Point;
    }
  | {
      readonly kind: "angle";
      readonly vertex: Point;
      readonly firstRayPoint: Point;
      readonly secondRayPoint: Point;
    }
  | {
      readonly kind: "polygon";
      readonly vertices: readonly Point[];
    }
  | {
      readonly kind: "circle";
      readonly center: Point;
      readonly radius: number;
    }
  | {
      readonly kind: "arc";
      readonly center: Point;
      readonly radius: number;
      readonly startAngleDegrees: number;
      readonly endAngleDegrees: number;
    };

export interface MathShapeLabel {
  readonly id: string;
  readonly text: string;
  readonly target: "vertex" | "edge" | "angle" | "center" | "shape";
  readonly targetIndex?: number;
  readonly position?: Point;
}

export interface MathShapeMark {
  readonly id: string;
  readonly markType: "length" | "angle" | "parallel" | "perpendicular";
  readonly targetIndices: readonly number[];
  readonly value?: string;
}

export interface MathShape extends BaseMathObject {
  readonly kind: "shape";
  readonly shapeType: MathShapeType;
  readonly preset?: MathShapePreset;
  readonly geometry: MathShapeGeometry;
  readonly labels: readonly MathShapeLabel[];
  readonly marks: readonly MathShapeMark[];
}

export type ArithmeticType = "add" | "subtract" | "multiply" | "divide";

export interface ArithmeticCell {
  readonly id: string;
  /** Zero-based column counted from the right. */
  readonly column: number;
  /** Kept as text intentionally; values are never calculated or corrected. */
  readonly value: string;
}

export interface ArithmeticRow {
  readonly id: string;
  readonly rowType: "operand" | "partial" | "result" | "note";
  readonly cells: readonly ArithmeticCell[];
  readonly offsetColumns: number;
  readonly operator?: "+" | "−" | "×" | "÷";
}

export interface ArithmeticCarryMark {
  readonly id: string;
  readonly column: number;
  readonly value: string;
  readonly sourceRowId?: string;
}

export interface ArithmeticSeparator {
  readonly id: string;
  readonly afterRowId: string;
  readonly lineStyle: "solid" | "dashed";
}

export interface ArithmeticCursor {
  readonly rowId: string;
  readonly column: number;
}

export interface ArithmeticLayout extends BaseMathObject {
  readonly kind: "arithmetic_layout";
  readonly arithmeticType: ArithmeticType;
  readonly operands: readonly string[];
  readonly rows: readonly ArithmeticRow[];
  readonly carryMarks: readonly ArithmeticCarryMark[];
  readonly separators: readonly ArithmeticSeparator[];
  readonly cursor?: ArithmeticCursor;
}

export type MathObject =
  | MathExpression
  | MathTable
  | MathGraph
  | MathShape
  | ArithmeticLayout;

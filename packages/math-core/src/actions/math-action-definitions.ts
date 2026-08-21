import type { MathObjectKind } from "../domain/math-object";
import type { MathActionId } from "./math-action";

export interface MathActionDefinition {
  readonly id: MathActionId;
  readonly objectKind: MathObjectKind;
  readonly target: "create" | "existing";
  readonly milestone: "B" | "C" | "D";
  readonly summary: string;
}

export const MATH_ACTION_DEFINITIONS = [
  definition("math.expression.create", "expression", "create", "B", "Create an editable expression."),
  definition("math.expression.update", "expression", "existing", "B", "Update expression content or display options."),
  definition("math.expression.insert_fraction", "expression", "existing", "B", "Insert a fraction node."),
  definition("math.expression.insert_power", "expression", "existing", "B", "Insert a power node."),
  definition("math.expression.insert_root", "expression", "existing", "B", "Insert a root node."),
  definition("math.table.create", "table", "create", "B", "Create a general or function-value table."),
  definition("math.table.set_cell", "table", "existing", "B", "Write text into one table cell."),
  definition("math.table.add_row", "table", "existing", "B", "Add one table row."),
  definition("math.table.add_column", "table", "existing", "B", "Add one table column."),
  definition("math.graph.create", "graph", "create", "B", "Create a graph with typed function descriptors."),
  definition("math.graph.add_point", "graph", "existing", "C", "Add a named or unnamed graph point."),
  definition("math.graph.add_tangent", "graph", "existing", "C", "Add a deterministic tangent at an x value."),
  definition("math.graph.add_helper_line", "graph", "existing", "C", "Add a vertical, horizontal, guide, or segment line."),
  definition("math.graph.label_point", "graph", "existing", "C", "Set the label of an existing point."),
  definition("math.shape.create", "shape", "create", "B", "Create a shape from explicit geometry."),
  definition("math.shape.create_line", "shape", "create", "B", "Create a line, segment, or ray."),
  definition("math.shape.create_triangle", "shape", "create", "B", "Create a triangle with an optional preset."),
  definition("math.shape.create_rectangle", "shape", "create", "B", "Create a rectangle or square."),
  definition("math.shape.create_circle", "shape", "create", "B", "Create a circle."),
  definition("math.shape.create_polygon", "shape", "create", "B", "Create a polygon from vertices."),
  definition("math.shape.label_vertex", "shape", "existing", "B", "Label a shape vertex."),
  definition("math.shape.mark_angle", "shape", "existing", "B", "Add an angle measurement mark."),
  definition("math.shape.mark_parallel", "shape", "existing", "B", "Mark selected edges as parallel."),
  definition("math.shape.mark_perpendicular", "shape", "existing", "B", "Mark selected edges as perpendicular."),
  definition("math.arithmetic.setup_vertical_add", "arithmetic_layout", "create", "D", "Set up vertical addition without calculating."),
  definition("math.arithmetic.setup_vertical_subtract", "arithmetic_layout", "create", "D", "Set up vertical subtraction without calculating."),
  definition("math.arithmetic.setup_vertical_multiply", "arithmetic_layout", "create", "D", "Set up vertical multiplication without calculating."),
  definition("math.arithmetic.write_digit", "arithmetic_layout", "existing", "D", "Write user-provided text into one arithmetic cell."),
  definition("math.arithmetic.write_carry", "arithmetic_layout", "existing", "D", "Write a user-provided carry mark."),
  definition("math.arithmetic.write_partial_row", "arithmetic_layout", "existing", "D", "Write a user-provided partial row."),
  definition("math.arithmetic.draw_separator", "arithmetic_layout", "existing", "D", "Draw a separator after a row."),
  definition("math.arithmetic.advance_cursor", "arithmetic_layout", "existing", "D", "Move the next writable slot."),
  definition("math.arithmetic.add_row", "arithmetic_layout", "existing", "D", "Add an explicit handwritten-work row."),
] as const satisfies readonly MathActionDefinition[];

export const mathActionDefinitionById = (
  id: MathActionId,
): MathActionDefinition => {
  const found = MATH_ACTION_DEFINITIONS.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`Unknown math action: ${id}`);
  }
  return found;
};

function definition(
  id: MathActionId,
  objectKind: MathObjectKind,
  target: MathActionDefinition["target"],
  milestone: MathActionDefinition["milestone"],
  summary: string,
): MathActionDefinition {
  return { id, objectKind, target, milestone, summary };
}

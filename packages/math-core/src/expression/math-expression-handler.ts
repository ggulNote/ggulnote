import type {
  CreateMathExpressionInput,
  MathActionInputMap,
  UpdateMathExpressionInput,
} from "../actions/math-action";
import type { MathExpression, MathExpressionNode } from "../domain/math-object";
import {
  createBaseMathObject,
  validateMathObject,
} from "../handlers/math-handler-support";

export const createMathExpression = (
  input: CreateMathExpressionInput,
  objectId: string,
): MathExpression => validateMathObject({
  ...createBaseMathObject(
    "expression",
    objectId,
    input,
    input.content.root === undefined
      ? []
      : [{ id: `${objectId}:root`, kind: "expression_node" }],
  ),
  kind: "expression",
  content: cloneExpressionContent(input.content),
  displayMode: input.displayMode ?? "block",
  alignment: input.alignment ?? "left",
  editable: input.editable ?? true,
});

export const updateMathExpression = (
  expression: MathExpression,
  input: UpdateMathExpressionInput,
): MathExpression => {
  assertTarget(expression, input.objectId);
  const content = input.patch.content === undefined
    ? expression.content
    : cloneExpressionContent(input.patch.content);
  return validateMathObject({
    ...expression,
    ...input.patch,
    content,
    style: input.patch.style === undefined
      ? expression.style
      : { ...input.patch.style },
    children: content.root === undefined
      ? []
      : [{ id: `${expression.id}:root`, kind: "expression_node" }],
  });
};

export const insertMathFraction = (
  expression: MathExpression,
  input: MathActionInputMap["math.expression.insert_fraction"],
): MathExpression => replaceWithNode(expression, input.objectId, input.path, {
  type: "fraction",
  numerator: input.numerator,
  denominator: input.denominator,
});

export const insertMathPower = (
  expression: MathExpression,
  input: MathActionInputMap["math.expression.insert_power"],
): MathExpression => replaceWithNode(expression, input.objectId, input.path, {
  type: "power",
  base: input.base,
  exponent: input.exponent,
});

export const insertMathRoot = (
  expression: MathExpression,
  input: MathActionInputMap["math.expression.insert_root"],
): MathExpression => replaceWithNode(expression, input.objectId, input.path, {
  type: "root",
  radicand: input.radicand,
  ...(input.index === undefined ? {} : { index: input.index }),
});

export const replaceMathExpressionNodeAtPath = (
  root: MathExpressionNode,
  path: readonly number[],
  replacement: MathExpressionNode,
): MathExpressionNode => {
  if (path.length === 0) return cloneNode(replacement);
  const [childIndex, ...remaining] = path;
  if (childIndex === undefined || !Number.isInteger(childIndex) || childIndex < 0) {
    throw new RangeError("Expression path indices must be non-negative integers.");
  }
  const replaceChild = (child: MathExpressionNode): MathExpressionNode =>
    replaceMathExpressionNodeAtPath(child, remaining, replacement);
  switch (root.type) {
    case "sequence": {
      if (childIndex >= root.items.length) throw invalidPath(path);
      return {
        ...root,
        items: root.items.map((item, index) => index === childIndex ? replaceChild(item) : item),
      };
    }
    case "fraction":
      if (childIndex === 0) return { ...root, numerator: replaceChild(root.numerator) };
      if (childIndex === 1) return { ...root, denominator: replaceChild(root.denominator) };
      throw invalidPath(path);
    case "power":
      if (childIndex === 0) return { ...root, base: replaceChild(root.base) };
      if (childIndex === 1) return { ...root, exponent: replaceChild(root.exponent) };
      throw invalidPath(path);
    case "subscript":
      if (childIndex === 0) return { ...root, base: replaceChild(root.base) };
      if (childIndex === 1) return { ...root, subscript: replaceChild(root.subscript) };
      throw invalidPath(path);
    case "root":
      if (childIndex === 0) return { ...root, radicand: replaceChild(root.radicand) };
      if (childIndex === 1 && root.index !== undefined) {
        return { ...root, index: replaceChild(root.index) };
      }
      throw invalidPath(path);
    case "group":
      if (childIndex === 0) return { ...root, content: replaceChild(root.content) };
      throw invalidPath(path);
    case "equation":
      if (childIndex === 0) return { ...root, left: replaceChild(root.left) };
      if (childIndex === 1) return { ...root, right: replaceChild(root.right) };
      throw invalidPath(path);
    case "system": {
      if (childIndex >= root.equations.length) throw invalidPath(path);
      return {
        ...root,
        equations: root.equations.map((equation, index) =>
          index === childIndex ? replaceChild(equation) : equation),
      };
    }
    case "text":
      throw invalidPath(path);
  }
};

export const formatMathExpressionNode = (node: MathExpressionNode): string => {
  switch (node.type) {
    case "text":
      return node.value;
    case "sequence":
      return node.items.map(formatMathExpressionNode).join("");
    case "fraction":
      return `(${formatMathExpressionNode(node.numerator)})/(${formatMathExpressionNode(node.denominator)})`;
    case "power":
      return `${formatMathExpressionNode(node.base)}^(${formatMathExpressionNode(node.exponent)})`;
    case "subscript":
      return `${formatMathExpressionNode(node.base)}_(${formatMathExpressionNode(node.subscript)})`;
    case "root":
      return node.index === undefined
        ? `√(${formatMathExpressionNode(node.radicand)})`
        : `root[${formatMathExpressionNode(node.index)}](${formatMathExpressionNode(node.radicand)})`;
    case "group":
      return `${node.opening}${formatMathExpressionNode(node.content)}${node.closing}`;
    case "equation":
      return `${formatMathExpressionNode(node.left)} ${node.operator} ${formatMathExpressionNode(node.right)}`;
    case "system":
      return node.equations.map(formatMathExpressionNode).join("\n");
  }
};

export const getMathExpressionDisplayText = (expression: MathExpression): string =>
  expression.content.root === undefined
    ? expression.content.source
    : formatMathExpressionNode(expression.content.root);

function replaceWithNode(
  expression: MathExpression,
  objectId: string,
  path: readonly number[],
  replacement: MathExpressionNode,
): MathExpression {
  assertTarget(expression, objectId);
  if (expression.content.root === undefined && path.length > 0) {
    throw new RangeError("Cannot follow a path in an expression without a structured root.");
  }
  const root = expression.content.root === undefined
    ? cloneNode(replacement)
    : replaceMathExpressionNodeAtPath(expression.content.root, path, replacement);
  return validateMathObject({
    ...expression,
    content: {
      source: formatMathExpressionNode(root),
      format: "structured",
      root,
    },
    children: [{ id: `${expression.id}:root`, kind: "expression_node" }],
  });
}

function cloneExpressionContent(
  content: MathExpression["content"],
): MathExpression["content"] {
  return {
    source: content.source,
    format: content.format,
    ...(content.root === undefined ? {} : { root: cloneNode(content.root) }),
  };
}

function cloneNode(node: MathExpressionNode): MathExpressionNode {
  return JSON.parse(JSON.stringify(node)) as MathExpressionNode;
}

function assertTarget(expression: MathExpression, objectId: string): void {
  if (expression.id !== objectId) {
    throw new Error(`Math expression target does not exist: ${objectId}`);
  }
}

function invalidPath(path: readonly number[]): RangeError {
  return new RangeError(`Expression path is outside the structured tree: ${path.join(".")}`);
}

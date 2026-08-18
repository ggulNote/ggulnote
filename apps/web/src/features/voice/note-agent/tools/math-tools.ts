import {
  CONNECTED_MATH_ACTION_IDS,
  connectedMathActionDecisionArgsSchema,
  createConnectedMathAction,
  createMathAction,
  deserializeMathObject,
  mathActionDefinitionById,
  parseConnectedMathActionDecisionArgs,
  prepareMathActionExecution,
  type ConnectedMathActionId,
  type MathObject,
  type MathObjectKind,
} from "@ggulnote/math-core";
import { NoteAgentValidationError, type DecisionObjectRef } from "../domain";
import { editorMathSceneId } from "../../integration/editor-voice-context";
import type { NoteSchema, NoteTool, NoteToolContext } from "./note-tool-registry";

interface MathToolInput {
  readonly args: Readonly<Record<string, unknown>>;
  readonly target?: DecisionObjectRef;
}

interface PreparedMathValue {
  readonly logicalObjectId: string;
  readonly objectKind: MathObjectKind;
}

export function createMathTools(): readonly NoteTool[] {
  return CONNECTED_MATH_ACTION_IDS.map((actionId) => mathActionTool(actionId));
}

function mathActionTool(actionId: ConnectedMathActionId): NoteTool<MathToolInput, PreparedMathValue> {
  const definition = mathActionDefinitionById(actionId);
  return {
    id: actionId,
    kind: "MUTATION",
    description: actionDescription(actionId, definition.summary),
    examples: actionExamples(actionId),
    inputSchema: mathToolInputSchema(actionId),
    outputSchema: preparedMathValueSchema,
    decisionArgsSchema: connectedMathActionDecisionArgsSchema(actionId),
    isAvailable: () => true,
    prepare: async (input, context) => {
      const currentObject = input.target === undefined
        ? undefined
        : mathObjectForHandle(input.target.object, context);
      if (definition.target === "existing" && currentObject === undefined) {
        return { status: "NOT_FOUND" };
      }
      if (definition.target === "create" && input.target !== undefined) {
        return { status: "NOT_ALLOWED", reasonCode: "MATH_CREATE_TARGET_NOT_ALLOWED" };
      }
      const logicalObjectId = currentObject?.id
        ?? createLogicalObjectId(context, definition.objectKind);
      const bounds = definition.target === "create"
        ? defaultMathBounds(definition.objectKind, context)
        : undefined;
      const action = createConnectedMathAction(actionId, input.args, {
        objectId: logicalObjectId,
        ...(bounds === undefined ? {} : { bounds }),
      });
      const prepared = prepareMathActionExecution(action, {
        getObject: (objectId) => currentObject?.id === objectId ? currentObject : undefined,
      });
      const renderReady = actionId === "math.arithmetic.setup_vertical_multiply"
        ? addSetupSeparator(prepared.object)
        : prepared;
      const outputRef = {
        kind: "OBJECT" as const,
        objectId: editorMathSceneId(
          context.frozenWorld.pageId,
          renderReady.object.id,
          renderReady.object.kind,
        ),
      };
      return {
        status: "READY",
        value: {
          logicalObjectId: renderReady.object.id,
          objectKind: renderReady.object.kind,
        },
        operations: [{
          kind: "EXISTING_EDITOR_OPERATION",
          data: {
            tldrawOperation: {
              kind: "APPLY_MATH_RENDER_OPERATION",
              operation: renderReady.renderOperation,
            },
            output: outputRef,
            ...(input.target === undefined
              ? {}
              : { target: context.handles?.resolve(input.target.object) }),
          },
        }],
      };
    },
  };
}

function addSetupSeparator(object: MathObject) {
  if (object.kind !== "arithmetic_layout") {
    throw new TypeError("Vertical multiplication did not create an arithmetic layout.");
  }
  const lastOperandRow = object.rows.filter((row) => row.rowType === "operand").at(-1);
  if (lastOperandRow === undefined) {
    throw new TypeError("Vertical multiplication has no operand row.");
  }
  return prepareMathActionExecution(createMathAction("math.arithmetic.draw_separator", {
    objectId: object.id,
    afterRowId: lastOperandRow.id,
  }), {
    getObject: (objectId) => objectId === object.id ? object : undefined,
  });
}

function mathToolInputSchema(actionId: ConnectedMathActionId): NoteSchema<MathToolInput> {
  return {
    compact: Object.freeze({}),
    parse(value, path = "input") {
      const input = strictRecord(value, path);
      const { target, ...decisionArgs } = input;
      let args: Readonly<Record<string, unknown>>;
      try {
        args = parseConnectedMathActionDecisionArgs(actionId, decisionArgs);
      } catch (error) {
        throw new NoteAgentValidationError(path, errorMessage(error));
      }
      if (actionId === "math.graph.add_point") {
        if (target === undefined) {
          throw new NoteAgentValidationError(`${path}.target`, "expected a graph ObjectHandle");
        }
        return { args, target: parseWholeObjectRef(target, `${path}.target`) };
      }
      if (target !== undefined) {
        throw new NoteAgentValidationError(`${path}.target`, "create action does not accept a target");
      }
      return { args };
    },
  };
}

function mathObjectForHandle(handle: string, context: NoteToolContext): MathObject | undefined {
  const ref = context.handles?.resolve(handle);
  const objectId = ref?.kind === "OBJECT" || ref?.kind === "OBJECT_PART"
    ? ref.objectId
    : undefined;
  if (objectId === undefined) return undefined;
  const sceneObject = context.world.getObject(objectId);
  const snapshot = (sceneObject as { readonly mathObjectSnapshot?: unknown } | undefined)
    ?.mathObjectSnapshot;
  if (snapshot === undefined) return undefined;
  try {
    return deserializeMathObject(snapshot);
  } catch {
    return undefined;
  }
}

function createLogicalObjectId(context: NoteToolContext, kind: MathObjectKind): string {
  const turn = safeIdPart(context.turnId);
  const step = safeIdPart(context.stepId ?? "step");
  return `math-${kind}-${turn}-${step}`;
}

function defaultMathBounds(kind: MathObjectKind, context: NoteToolContext) {
  const scene = context.world.getSnapshot(
    context.frozenWorld.pageId,
    context.frozenWorld.sceneRevision,
  );
  const page = scene?.page ?? { width: 600, height: 800 };
  const preferred = kind === "graph"
    ? { width: 360, height: 300 }
    : kind === "shape"
      ? { width: 240, height: 160 }
      : kind === "arithmetic_layout"
        ? { width: 220, height: 190 }
        : { width: 320, height: 80 };
  const width = Math.max(1, Math.min(preferred.width, page.width * 0.8));
  const height = Math.max(1, Math.min(preferred.height, page.height * 0.8));
  return {
    x: Math.max(0, (page.width - width) / 2),
    y: Math.max(0, (page.height - height) / 2),
    width,
    height,
  };
}

function parseWholeObjectRef(value: unknown, path: string): DecisionObjectRef {
  const target = strictRecord(value, path);
  const keys = Object.keys(target);
  if (keys.some((key) => key !== "object" && key !== "part")) {
    throw new NoteAgentValidationError(path, "unexpected target field");
  }
  if (typeof target.object !== "string" || !/^O[1-9][0-9]*$/u.test(target.object)) {
    throw new NoteAgentValidationError(`${path}.object`, "expected an ObjectHandle");
  }
  if (target.part !== null) {
    throw new NoteAgentValidationError(`${path}.part`, "expected the whole graph object");
  }
  return { object: target.object as DecisionObjectRef["object"], part: null };
}

const preparedMathValueSchema: NoteSchema<PreparedMathValue> = {
  compact: Object.freeze({ logicalObjectId: "string", objectKind: "MathObjectKind" }),
  parse(value, path = "output") {
    const output = strictRecord(value, path);
    if (typeof output.logicalObjectId !== "string" || output.logicalObjectId.length === 0) {
      throw new NoteAgentValidationError(`${path}.logicalObjectId`, "expected a non-empty string");
    }
    const objectKind = output.objectKind;
    if (objectKind !== "expression" && objectKind !== "table" && objectKind !== "graph"
      && objectKind !== "shape" && objectKind !== "arithmetic_layout") {
      throw new NoteAgentValidationError(`${path}.objectKind`, "expected a MathObjectKind");
    }
    return { logicalObjectId: output.logicalObjectId, objectKind };
  },
};

function actionDescription(actionId: ConnectedMathActionId, summary: string): string {
  switch (actionId) {
    case "math.graph.create":
      return `${summary} Supply the typed descriptor; for x squared use quadratic with parameters a=1, b=0, c=0.`;
    case "math.graph.add_point":
      return `${summary} Select the existing graph handle as target; null coordinates create the deterministic smoke-test point (1, 1).`;
    case "math.shape.create_rectangle":
      return `${summary} Geometry is supplied deterministically by the runtime.`;
    case "math.expression.create":
    case "math.arithmetic.setup_vertical_multiply":
      return summary;
  }
}

function actionExamples(actionId: ConnectedMathActionId): readonly string[] {
  switch (actionId) {
    case "math.expression.create": return ["x제곱 더하기 2x 더하기 1이라고 써줘"];
    case "math.graph.create": return ["x제곱 그래프 그려줘"];
    case "math.shape.create_rectangle": return ["직사각형 하나 그려줘"];
    case "math.arithmetic.setup_vertical_multiply": return ["58 곱하기 72 세로셈으로 써줘"];
    case "math.graph.add_point": return ["방금 만든 그래프에 점 하나 찍어줘"];
  }
}

function strictRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NoteAgentValidationError(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NoteAgentValidationError(path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function safeIdPart(value: string): string {
  const result = value.trim().replace(/[^A-Za-z0-9_-]+/gu, "-");
  return result.length === 0 ? "turn" : result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid math action args";
}

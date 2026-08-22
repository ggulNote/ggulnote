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
import type { MeasuredDraft } from "../../domain";
import {
  NoteAgentValidationError,
  parseActionTarget,
  parseCanvasPlacement,
  type CanvasPlacement,
  type DecisionObjectRef,
  type NoteActionPrepareResult,
  type NoteToolId,
} from "../domain";
import { projectCanvasPlacement } from "../runtime";
import { editorMathSceneId } from "../../integration/editor-voice-context";
import type {
  NoteSchema,
  NoteTool,
  NoteToolContext,
} from "./note-tool-registry";

interface MathToolInput {
  readonly args: Readonly<Record<string, unknown>>;
  readonly target?: DecisionObjectRef;
  readonly placement?: CanvasPlacement;
}

interface PreparedMathValue {
  readonly logicalObjectId: string;
  readonly objectKind: MathObjectKind;
}

export interface MathCreatePlacementContract {
  readonly draft: MeasuredDraft;
}

export function createMathTools(): readonly NoteTool[] {
  return CONNECTED_MATH_ACTION_IDS.map((actionId) => mathActionTool(actionId));
}

export function createMathPlacementContract(
  toolId: NoteToolId,
  draftKey: string,
  availableSize: { readonly width: number; readonly height: number },
): MathCreatePlacementContract | undefined {
  if (!(CONNECTED_MATH_ACTION_IDS as readonly string[]).includes(toolId)) return undefined;
  const actionId = toolId as ConnectedMathActionId;
  const definition = mathActionDefinitionById(actionId);
  if (definition.target !== "create") return undefined;
  const requested = preferredMathSize(definition.objectKind);
  const preferredSize = Object.freeze({
    width: Math.max(1, Math.min(requested.width, availableSize.width)),
    height: Math.max(1, Math.min(requested.height, availableSize.height)),
  });
  const capability = mathPlacementCapability(definition.objectKind);
  return Object.freeze({
    draft: Object.freeze({
      draftKey,
      capability,
      kind: `MATH_${definition.objectKind.toUpperCase()}`,
      preferredFootprint: preferredSize,
      measurementSource: "PROFILE_FALLBACK",
    }),
  });
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
      const currentObject = definition.target !== "existing"
        || input.target?.object === null
        || input.target === undefined
        ? undefined
        : mathObjectForHandle(input.target.object, context);
      if (definition.target === "existing" && currentObject === undefined) {
        return { status: "NOT_FOUND" };
      }
      const logicalObjectId = currentObject?.id
        ?? createLogicalObjectId(context, definition.objectKind);
      const directShapeBounds = definition.target === "create"
        && definition.objectKind === "shape"
        && input.placement === undefined
        && context.resolvedTarget !== undefined
        ? directShapeTargetBounds(context)
        : undefined;
      const placement = definition.target === "create" && directShapeBounds === undefined
        ? await resolveMathCreatePlacement(actionId, input, context)
        : undefined;
      if (placement !== undefined && placement.status !== "RESOLVED") {
        return placement.failure;
      }
      const bounds = definition.target === "create"
        ? directShapeBounds ?? placement?.bounds
        : undefined;
      const action = createConnectedMathAction(actionId, input.args, {
        objectId: logicalObjectId,
        ...(bounds === undefined ? {} : { bounds }),
        ...(currentObject === undefined ? {} : { currentObject }),
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
              : input.target.object === null
                ? {}
                : { target: context.handles?.resolve(input.target.object) }),
          },
        }],
      };
    },
  };
}

type MathCreatePlacementResolution =
  | {
      readonly status: "RESOLVED";
      readonly bounds: import("@ggulnote/editor-core").Rect;
    }
  | {
      readonly status: "FAILED";
      readonly failure: Exclude<NoteActionPrepareResult<never>, { readonly status: "READY" }>;
    };

async function resolveMathCreatePlacement(
  actionId: ConnectedMathActionId,
  input: MathToolInput,
  context: NoteToolContext,
): Promise<MathCreatePlacementResolution> {
  if (context.preparePlacement === undefined) {
    return {
      status: "FAILED",
      failure: { status: "NOT_ALLOWED", reasonCode: "PLACEMENT_UNAVAILABLE" },
    };
  }
  const prepared = await context.preparePlacement(actionId, input);
  if (prepared === undefined) {
    return {
      status: "FAILED",
      failure: { status: "NOT_ALLOWED", reasonCode: "MEASUREMENT_UNAVAILABLE" },
    };
  }
  if (input.placement === undefined) {
    return { status: "FAILED", failure: { status: "NEEDS_INPUT", missing: ["placement"] } };
  }
  const result = projectCanvasPlacement({
    placement: input.placement,
    snapshot: prepared.snapshot,
    draft: prepared.draft,
  });
  switch (result.status) {
    case "RESOLVED":
      return {
        status: "RESOLVED",
        bounds: result.bounds,
      };
    case "INVALID":
      return { status: "FAILED", failure: { status: "FAILED", reasonCode: result.reasonCode } };
  }
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
      const { target, placement, ...decisionArgs } = input;
      let args: Readonly<Record<string, unknown>>;
      try {
        args = parseConnectedMathActionDecisionArgs(actionId, decisionArgs);
      } catch (error) {
        throw new NoteAgentValidationError(path, errorMessage(error));
      }
      const definition = mathActionDefinitionById(actionId);
      if (definition.target === "existing") {
        if (target === undefined) {
          throw new NoteAgentValidationError(`${path}.target`, "expected an existing math ObjectHandle");
        }
        if (placement !== undefined) {
          throw new NoteAgentValidationError(`${path}.placement`, "existing-object math actions do not accept placement");
        }
        return {
          args,
          target: parseExistingMathObjectRef(
            target,
            `${path}.target`,
            definition.objectKind === "graph",
          ),
        };
      }
      if (target !== undefined) {
        return {
          args,
          target: parseActionTarget(target, `${path}.target`),
          ...(placement === undefined || placement === null
            ? {}
            : { placement: parseCanvasPlacement(placement, `${path}.placement`) }),
        };
      }
      return {
        args,
        ...(placement === undefined || placement === null
          ? {}
          : { placement: parseCanvasPlacement(placement, `${path}.placement`) }),
      };
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

function directShapeTargetBounds(
  context: NoteToolContext,
): import("@ggulnote/editor-core").Rect | undefined {
  const target = context.resolvedTarget;
  if (target === undefined) return undefined;
  if (target.mode !== "FALLBACK_POINT") return { ...target.canvasBounds };
  const scene = context.world.getSnapshot(
    context.frozenWorld.pageId,
    context.frozenWorld.sceneRevision,
  );
  if (scene === undefined) return undefined;
  const preferred = preferredMathSize("shape");
  const width = Math.min(preferred.width, scene.page.width);
  const height = Math.min(preferred.height, scene.page.height);
  return {
    x: Math.max(0, Math.min(scene.page.width - width, target.canvasPoint.x - width / 2)),
    y: Math.max(0, Math.min(scene.page.height - height, target.canvasPoint.y - height / 2)),
    width,
    height,
  };
}

function preferredMathSize(kind: MathObjectKind) {
  if (kind === "graph") return { width: 360, height: 300 };
  if (kind === "shape") return { width: 240, height: 160 };
  if (kind === "arithmetic_layout") return { width: 220, height: 190 };
  if (kind === "table") return { width: 320, height: 220 };
  return { width: 320, height: 80 };
}

function mathPlacementCapability(kind: MathObjectKind): MeasuredDraft["capability"] {
  if (kind === "graph") return "graph";
  if (kind === "shape") return "shape";
  if (kind === "table") return "table";
  return "math";
}

function parseExistingMathObjectRef(
  value: unknown,
  path: string,
  allowGraphCurve: boolean,
): DecisionObjectRef {
  const target = parseActionTarget(value, path);
  if (target.object === null) {
    throw new NoteAgentValidationError(`${path}.object`, "expected an ObjectHandle");
  }
  if (target.region !== undefined && target.region !== null) {
    throw new NoteAgentValidationError(`${path}.region`, "existing math actions target the whole object");
  }
  if (target.fallbackPoint !== undefined && target.fallbackPoint !== null) {
    throw new NoteAgentValidationError(`${path}.fallbackPoint`, "existing math actions require the graph object");
  }
  if (target.part !== null) {
    const part = target.part;
    const hasQualifiedSelector = [
      part.index, part.row, part.column, part.text, part.startText, part.endText,
    ].some((entry) => entry !== null && entry !== undefined);
    if (!allowGraphCurve || part.kind !== "curve" || hasQualifiedSelector) {
      throw new NoteAgentValidationError(
        `${path}.part`,
        "expected the whole math object or its unqualified graph curve",
      );
    }
  }
  return {
    object: target.object,
    part: null,
    ...(target.region === undefined ? {} : { region: null }),
    ...(target.fallbackPoint === undefined ? {} : { fallbackPoint: null }),
  };
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
      return `${summary} Supply only the canonical expression; math-core compiles and renders it deterministically.`;
    case "math.graph.add_point":
      return `${summary} Select the graph target and supply the exact graph-domain point.`;
    case "math.graph.add_tangent":
      return "Add a tangent to an existing graph at an exact graph-domain x selected by the Decision; math-core computes the derivative and tangent.";
    case "math.shape.create_rectangle":
    case "math.shape.create_circle":
      return `${summary} Geometry is supplied deterministically by the runtime.`;
    case "math.expression.create":
      return "Create mathematical notation, an equation, or a formula. Convert conversational spoken math into canonical source such as x^2+1 instead of copying the transcript.";
    case "math.arithmetic.setup_vertical_multiply":
      return summary;
  }
}

function actionExamples(actionId: ConnectedMathActionId): readonly string[] {
  switch (actionId) {
    case "math.expression.create": return ["x제곱 더하기 2x 더하기 1이라고 써줘"];
    case "math.graph.create": return ["x제곱 그래프 그려줘"];
    case "math.shape.create_rectangle": return ["직사각형 하나 그려줘"];
    case "math.shape.create_circle": return ["표시할 곳에 동그라미 쳐줘"];
    case "math.arithmetic.setup_vertical_multiply": return ["58 곱하기 72 세로셈으로 써줘"];
    case "math.graph.add_point": return ["방금 만든 그래프에 점 하나 찍어줘"];
    case "math.graph.add_tangent": return ["x제곱 그래프 2사분면 쪽에 접선 하나 그어줘"];
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

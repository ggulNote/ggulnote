import {
  canonicalToNormalizedRect,
  type Rect,
  type Size,
} from "@ggulnote/editor-core";
import type {
  DirectCommandCompileResult,
  DirectCommandRouteErrorCode,
  DirectEditorCommand,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
} from "../domain";

const ANNOTATABLE_TARGET_TYPES = new Set([
  "sentence",
  "paragraph",
  "line",
  "word",
  "text",
]);

export interface DirectCommandCompileContext {
  pageSize?: Size;
}

export function compileDirectCommandCapability(
  ready: ReadyForDirectCommandExecution,
  context: DirectCommandCompileContext,
): DirectCommandCompileResult {
  const relationError = unsupportedRelation(ready.plan.relation);
  if (relationError !== null) {
    return failed(relationError);
  }

  const command = ready.plan.command;
  switch (command.capability) {
    case "annotation":
      return compileAnnotation(command, ready, context);
    case "text":
      return compileTextReplacement(command, ready);
    case "navigation":
      return {
        status: "COMPILED",
        instruction: {
          kind: "NAVIGATE",
          direction: command.operation,
        },
      };
    case "history":
      return {
        status: "COMPILED",
        instruction: { kind: "UNDO" },
      };
  }
}

function compileAnnotation(
  command: Extract<DirectEditorCommand, { capability: "annotation" }>,
  ready: ReadyForDirectCommandExecution,
  context: DirectCommandCompileContext,
): DirectCommandCompileResult {
  const target = ready.target;
  if (target === undefined) {
    return failed("INVALID_TARGET");
  }
  const authorityError = targetAuthorityError(target, ready);
  if (authorityError !== null) {
    return failed(authorityError);
  }
  if (!target.annotatable) {
    return failed("TARGET_NOT_ANNOTATABLE");
  }
  if (!ANNOTATABLE_TARGET_TYPES.has(target.type)) {
    return failed("TARGET_KIND_UNSUPPORTED");
  }

  const canonicalBounds = singleTargetBounds(target);
  if (
    canonicalBounds === null
    || !isPositiveFiniteRect(canonicalBounds)
    || context.pageSize === undefined
    || !isPositiveFiniteSize(context.pageSize)
  ) {
    return failed("COMPILE_FAILED");
  }
  const bounds = canonicalToNormalizedRect(canonicalBounds, context.pageSize);
  if (!isPositiveFiniteRect(bounds)) {
    return failed("COMPILE_FAILED");
  }

  if (command.operation === "underline") {
    return {
      status: "COMPILED",
      instruction: {
        kind: "CREATE_ANNOTATION",
        input: {
          type: "UNDERLINE",
          pageId: target.pageId,
          bounds,
        },
      },
    };
  }

  const color = command.payload.color;
  if (color !== undefined && color.trim().length === 0) {
    return failed("COMPILE_FAILED");
  }
  return {
    status: "COMPILED",
    instruction: {
      kind: "CREATE_ANNOTATION",
      input: {
        type: "HIGHLIGHT",
        pageId: target.pageId,
        bounds,
        ...(color === undefined ? {} : { color }),
      },
    },
  };
}

function compileTextReplacement(
  command: Extract<DirectEditorCommand, { capability: "text" }>,
  ready: ReadyForDirectCommandExecution,
): DirectCommandCompileResult {
  const target = ready.target;
  if (target === undefined) {
    return failed("INVALID_TARGET");
  }
  const authorityError = targetAuthorityError(target, ready);
  if (authorityError !== null) {
    return failed(authorityError);
  }
  if (
    target.source !== "ggulnote"
    || !target.editable
  ) {
    return failed("TARGET_NOT_EDITABLE");
  }
  if (target.type !== "text" || target.objectId === undefined) {
    return failed("TARGET_KIND_UNSUPPORTED");
  }

  return {
    status: "COMPILED",
    instruction: {
      kind: "REPLACE_TEXT_CONTENT",
      pageId: target.pageId,
      sceneObjectId: target.objectId,
      text: command.payload.text,
    },
  };
}

function targetAuthorityError(
  target: ResolvedTarget,
  ready: ReadyForDirectCommandExecution,
): DirectCommandRouteErrorCode | null {
  if (
    target.pageId !== ready.context.frozenContext.pageId
    || target.sceneRevision !== ready.context.frozenContext.sceneRevision
    || ready.plan.sceneRevision !== ready.context.frozenContext.sceneRevision
  ) {
    return "STALE_SCENE";
  }
  const candidate = ready.context.pageTargetCatalog.candidates.find(
    (entry) => entry.candidateId === target.candidateId,
  );
  if (
    candidate === undefined
    || candidate.pageId !== target.pageId
    || candidate.source !== target.source
    || candidate.type !== target.type
    || (
      target.objectId !== undefined
      && candidate.sceneObjectId !== target.objectId
    )
  ) {
    return "INVALID_TARGET";
  }
  return null;
}

function singleTargetBounds(target: ResolvedTarget): Rect | null {
  if (target.kind === "object") {
    return target.bounds === undefined ? null : { ...target.bounds };
  }
  if (target.bounds === undefined || target.bounds.length !== 1) {
    return null;
  }
  return { ...target.bounds[0] };
}

function isPositiveFiniteRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function isPositiveFiniteSize(size: Size): boolean {
  return Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width > 0
    && size.height > 0;
}

function unsupportedRelation(
  relation: ReadyForDirectCommandExecution["plan"]["relation"],
): DirectCommandRouteErrorCode | null {
  if (relation === "REVISE_LAST") {
    return "REVISE_NOT_AVAILABLE";
  }
  return relation === "CONTINUE" ? "UNSUPPORTED_RELATION" : null;
}

function failed(
  errorCode: DirectCommandRouteErrorCode,
): DirectCommandCompileResult {
  return { status: "ERROR", errorCode };
}

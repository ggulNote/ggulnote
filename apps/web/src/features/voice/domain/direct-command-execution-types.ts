import type {
  AnnotationId,
  CreateAnnotationInput,
  PageId,
} from "@ggulnote/editor-core";
import type { DirectCommandRouteErrorCode } from "./direct-command-types";
import type { DirectCommandPlanningResult } from "./direct-command-planning-types";

export type ReadyForDirectCommandExecution = Extract<
  DirectCommandPlanningResult,
  { status: "READY_FOR_EXECUTION" }
>;

export type DirectAnnotationRuntimeInput = Extract<
  CreateAnnotationInput,
  { type: "TEXT" | "UNDERLINE" | "HIGHLIGHT" }
>;

export type DirectCommandRuntimeInstruction =
  | {
      kind: "CREATE_ANNOTATION";
      input: DirectAnnotationRuntimeInput;
    }
  | {
      kind: "REPLACE_TEXT_CONTENT";
      pageId: PageId;
      sceneObjectId: string;
      text: string;
    }
  | {
      kind: "UPDATE_HIGHLIGHT_COLOR";
      pageId: PageId;
      annotationId: AnnotationId;
      color: string;
    }
  | {
      kind: "NAVIGATE";
      direction: "next_page" | "previous_page";
    }
  | {
      kind: "UNDO";
    };

export type DirectCommandCompileResult =
  | {
      status: "COMPILED";
      instruction: DirectCommandRuntimeInstruction;
    }
  | {
      status: "ERROR";
      errorCode: DirectCommandRouteErrorCode;
    };

export type EditorInteractionMode =
  | "select"
  | "text"
  | "underline"
  | "highlight"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "table";

export const DEFAULT_INTERACTION_MODE: EditorInteractionMode = "select";

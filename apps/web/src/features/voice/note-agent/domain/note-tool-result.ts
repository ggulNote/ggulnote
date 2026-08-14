export type NoteToolResult<T = unknown> =
  | { readonly status: "SUCCESS"; readonly data: T }
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly unknown[] }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "NEEDS_INPUT"; readonly missing: readonly string[] }
  | { readonly status: "NOT_ALLOWED"; readonly reasonCode: string }
  | { readonly status: "NO_FEASIBLE_PLACEMENT" }
  | { readonly status: "STALE_SCENE" }
  | { readonly status: "FAILED"; readonly reasonCode: string };

export interface PreparedNoteOperation {
  readonly kind: "EXISTING_EDITOR_OPERATION";
  readonly data: unknown;
}

/** Action preparation never owns an Editor port or persistent mutation authority. */
export type NoteActionPrepareResult<T = unknown> =
  | {
      readonly status: "READY";
      readonly value: T;
      readonly operations: readonly PreparedNoteOperation[];
    }
  | Exclude<NoteToolResult<never>, { readonly status: "SUCCESS" }>;

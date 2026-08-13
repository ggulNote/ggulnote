export {
  NOTE_DECISION_MAX_BATCH_STEPS,
  NOTE_PAGE_REGIONS,
  NOTE_SELECTOR_MAX_DEPTH,
  NOTE_SPATIAL_RELATIONS,
} from "./note-agent-types";
export type {
  CompactToolSchema,
  Destination,
  EntitySelector,
  EntitySelectorContent,
  EntitySelectorContext,
  EntitySelectorScope,
  EntitySelectorSource,
  EntitySelectorTemporal,
  JsonPrimitive,
  JsonValue,
  NoteAlignment,
  NoteContextSummary,
  NoteDecision,
  NoteDecisionInput,
  NotePageRegion,
  NoteSpatialRelation,
  NoteToolCall,
  NoteToolId,
  NoteToolKind,
  SpatialConstraint,
  SpatialReference,
} from "./note-agent-types";
export type { NoteToolResult } from "./note-tool-result";
export {
  NoteAgentValidationError,
  parseDestination,
  parseEntitySelector,
  parseNoteDecision,
  parseNoteDecisionInput,
} from "./note-agent-schema";

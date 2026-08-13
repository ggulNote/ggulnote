export { createExistingNoteToolRegistry } from "./existing-tool-adapters";
export {
  addFiniteNumbers,
  createMathTools,
  multiplyNumericMatrices,
} from "./math-tools";
export type { MatrixMultiplyResult, NumericMatrix } from "./math-tools";
export { createUnavailableExtensionTools } from "./extension-boundary-tools";
export {
  NoteToolRegistry,
  resolveEntitySelector,
  unknownOutputSchema,
} from "./note-tool-registry";
export type {
  NotePlacementPreparation,
  NoteSchema,
  NoteTool,
  NoteToolContext,
  NoteTransactionPort,
  NoteTransactionReceipt,
  NoteTransactionResult,
  NoteTransactionStep,
} from "./note-tool-registry";

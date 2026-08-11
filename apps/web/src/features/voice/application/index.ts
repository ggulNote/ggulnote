export { SceneVoiceTurnContextSource, resolveVoiceFocusSnapshot } from "./voice-turn-context-source";
export type {
  SceneVoiceTurnContextSourceOptions,
  VoiceCurrentSceneReference,
  VoiceFocusCandidate,
  VoiceFocusCandidates,
  VoiceTurnContextCapture,
  VoiceTurnContextRead,
  VoiceTurnContextSource,
} from "./voice-turn-context-source";
export { DEFAULT_VOICE_TURN_TIMING_CONFIG, VoiceTurnController } from "./voice-turn-controller";
export type {
  VoiceTurnControlDiagnosticEvent,
  VoiceTurnDiagnostics,
} from "./voice-turn-diagnostics";
export { VoiceModeControllerImpl } from "./voice-mode-controller";
export type {
  VoiceTurnControllerOptions,
  VoiceTurnScheduler,
  VoiceTurnStateListener,
} from "./voice-turn-controller";
export type {
  VoiceModeController,
  VoiceModeControllerOptions,
  VoiceModeControllerScheduler,
} from "./voice-mode-controller";
export {
  buildPageTargetCatalog,
  summarizeEditorOperation,
} from "./page-target-catalog-builder";
export type { PageTargetCatalogBuilderInput } from "./page-target-catalog-builder";
export {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
} from "./direct-command-context-builder";
export {
  compactGroundingText,
  fuzzyTextSimilarity,
  normalizeGroundingText,
  rankTargetCandidates,
} from "./candidate-ranker";
export { FrozenTargetResolver } from "./frozen-target-resolver";
export {
  GroundedTargetRecovery,
  isRecoverableTargetResolution,
} from "./grounded-target-recovery";
export type {
  GroundedTargetRecoveryAttempt,
  GroundedTargetRecoveryOptions,
  GroundedTargetRecoveryPort,
  GroundedTargetRecoveryRequest,
  GroundedTargetRecoveryServiceOptions,
} from "./grounded-target-recovery";
export { TargetStrategyRouter } from "./target-strategy-router";
export type {
  TargetEmbeddingSearch,
  TargetStrategyResolutionPort,
  TargetStrategyResolveOptions,
  TargetStrategyRouterOptions,
} from "./target-strategy-router";
export { TARGET_STRATEGY_CONFIG } from "./target-resolution-policy";
export { BoundedSpeechRefiner } from "./bounded-speech-refiner";
export type {
  BoundedSpeechRefinerInput,
  BoundedSpeechRefinerOptions,
  BoundedSpeechRefinerPort,
} from "./bounded-speech-refiner";
export {
  buildFrozenPageTermIndex,
  extractTargetGroundingSlots,
  phoneticSimilarity,
  phoneticMorphologyCompatibility,
  retrieveTargetAwareGroundingEvidence,
  TARGET_RETRIEVAL_PROFILES,
} from "./target-aware-grounding-retrieval";
export type {
  TargetAwareGroundingRetrievalInput,
  TargetAwareGroundingRetrievalResult,
} from "./target-aware-grounding-retrieval";
export {
  buildSpanPairCandidates,
  canonicalizeAnchorCandidates,
  countTextSpanAnchorChunks,
  groundTextSpan,
  normalizeTextSpanAnchorSlot,
  pruneDominatedSpanPairs,
  retrieveAnchorSpanCandidates,
  TEXT_SPAN_GROUNDING_POLICY,
} from "./text-span-grounder";
export type {
  AnchorSpanCandidate,
  AnchorSpanEvidence,
  SpanPairCandidate,
  SpanPairEvidence,
  TextSpanGroundingDiagnostics,
  TextSpanGroundingInput,
  TextSpanGroundingResult,
} from "./text-span-grounder";
export {
  evaluateCandidateRecallAtK,
  evaluateTextSpanGroundingStages,
} from "./grounding-retrieval-evaluation";
export type {
  CandidateRecallEvaluationCase,
  CandidateRecallEvaluationResult,
  TextSpanGroundingEvaluationCase,
  TextSpanGroundingEvaluationResult,
} from "./grounding-retrieval-evaluation";
export {
  buildDocumentLexicon,
  normalizeSpokenMath,
  normalizeSpokenNumbers,
  parseSpokenInteger,
  TypedSpeechNormalizer,
} from "./typed-speech-normalizer";
export type {
  TypedSpeechNormalizationInput,
  TypedSpeechNormalizerOptions,
  TypedSpeechNormalizerPort,
} from "./typed-speech-normalizer";
export type {
  TargetEvidenceWeights,
  TargetStrategyConfig,
} from "./target-resolution-policy";
export { guardDirectCommandPlan } from "./direct-command-guard";
export type {
  DirectCommandGuardInput,
  DirectCommandGuardResult,
} from "./direct-command-guard";
export type {
  DirectCommandContextBuildOptions,
  DirectCommandContextBuilderOptions,
  DirectRecentOperationsSource,
  FrozenSceneSnapshotSource,
} from "./direct-command-context-builder";
export {
  classifySpatialProtection,
  DefaultSpatialProtectionPolicy,
  ExistingSceneSpatialSceneSource,
  toSpatialSceneObject,
} from "./spatial-scene-source";
export type {
  ExistingSceneSpatialSceneSourceOptions,
  FrozenSceneReadSource,
  FrozenSpatialSceneReference,
  SpatialSceneSource,
  SpatialSceneSourceResult,
} from "./spatial-scene-source";
export type {
  DraftMeasurementProvider,
  DraftMeasurementProviderResult,
  DraftMeasurementRequest,
  PlacementProfileProvider,
  PlacementProfileProviderResult,
  PlacementProfileRequest,
} from "./placement-profile-provider";
export { measureExistingObjectDraft } from "./placement-profile-provider";
export { DirectCommandPlanningPipeline } from "./direct-command-planning-pipeline";
export type {
  DirectCommandPlanningOptions,
  DirectCommandPlanningPipelineOptions,
} from "./direct-command-planning-pipeline";
export {
  buildDirectTargetDisambiguationContext,
} from "./direct-target-disambiguation-context";
export type {
  DirectTargetDisambiguationContext,
} from "./direct-target-disambiguation-context";
export {
  compileDirectCommandCapability,
  compileDirectCommandRevision,
} from "./direct-command-capability-compiler";
export { DirectCommandHistoryContext } from "./direct-command-history-context";
export type {
  DirectCommandHistoryContextOptions,
} from "./direct-command-history-context";
export {
  DirectCommandExecutionRegistry,
} from "./direct-command-execution-registry";
export type {
  DirectCommandExecutionRegistryOptions,
} from "./direct-command-execution-registry";
export { DirectCommandRoute } from "./direct-command-route";
export {
  calculateDirectCommandLatencyMetrics,
  DirectCommandTraceStore,
} from "./direct-command-diagnostics";
export type { DirectCommandTraceStoreOptions } from "./direct-command-diagnostics";
export type {
  DirectCommandExecutionPort,
  DirectCommandPlanningPort,
  DirectCommandRouteExecuteOptions,
  DirectCommandRouteOptions,
} from "./direct-command-route";
export type {
  DirectCommandCompileContext,
} from "./direct-command-capability-compiler";
export { evaluateGroundingCases } from "./grounding-evaluation";
export type {
  GroundingEvaluationCase,
  GroundingEvaluationCategory,
  GroundingEvaluationMetrics,
} from "./grounding-evaluation";

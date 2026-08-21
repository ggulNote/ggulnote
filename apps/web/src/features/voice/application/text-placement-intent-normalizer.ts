import {
  parseDirectPlannerResult,
  type DirectCommandContext,
  type DirectPlannerDraftResult,
  type DirectPlannerResult,
  type ExecutableDirectPlan,
  type NormalizedTextPlacement,
  type SpatialAlignment,
  type SpatialPlacementQuery,
  type SpatialReferenceQuery,
  type SpatialRegionHint,
  type TextPlacementAutoFlowSource,
  type TextPlacementChoicePolicy,
  type TextPlacementMode,
  type TextPlacementProvenance,
  type TextPlacementRecoveryReason,
} from "../domain";
import {
  extractSpatialPhraseEvidence,
  type HorizontalPlacementEvidence,
  type SpatialPhraseEvidence,
  type VerticalPlacementEvidence,
} from "./spatial-phrase-evidence";

export interface TextPlacementIntentNormalizationInput {
  readonly draft: DirectPlannerDraftResult;
  readonly context: DirectCommandContext;
}

export interface TextPlacementIntentNormalizationResult {
  readonly result: DirectPlannerResult;
  readonly placement?: NormalizedTextPlacement;
}

/**
 * Converts the narrowly recoverable text.create planner draft into the same
 * strict executable plan consumed by the existing Stage 4 guard/runtime.
 */
export function normalizeTextPlacementIntent(
  input: TextPlacementIntentNormalizationInput,
): TextPlacementIntentNormalizationResult {
  const draft = input.draft;
  if (
    draft.status !== "EXECUTABLE"
    || draft.command.capability !== "text"
    || draft.command.operation !== "create"
  ) {
    return { result: parseDirectPlannerResult(draft) };
  }

  const plannerPlacement = draft.placementQuery;
  const evidence = extractSpatialPhraseEvidence({
    transcript: input.context.turn.rawTranscript,
    content: draft.command.payload.text,
    hasFocus: hasUsableFocus(input.context),
  });
  const normalized = resolveEffectivePlacement(
    evidence,
    plannerPlacement,
    input.context,
  );
  const result = parseDirectPlannerResult({
    ...draft,
    placementQuery: normalized.effectiveQuery,
  });
  if (result.status !== "EXECUTABLE") {
    throw new Error("Text placement normalization must produce an executable plan.");
  }
  return { result, placement: normalized };
}

function resolveEffectivePlacement(
  evidence: SpatialPhraseEvidence,
  plannerPlacement: SpatialPlacementQuery | undefined,
  context: DirectCommandContext,
): NormalizedTextPlacement {
  const plannerPlacementPresent = plannerPlacement !== undefined;

  if (evidence.kind === "AUTO_FREE_SPACE") {
    const effectiveQuery = autoFreeSpaceQuery(evidence.scope);
    return placement({
      mode: "AUTO_FREE_SPACE",
      provenance: plannerPlacement === undefined || !samePlacement(plannerPlacement, effectiveQuery)
        ? "TRANSCRIPT_RECOVERED"
        : "PLANNER_EXPLICIT",
      choicePolicy: "USER_DELEGATED_LAYOUT",
      effectiveQuery,
      evidence,
      plannerPlacementPresent,
      conflictRecovered: plannerPlacement !== undefined
        && !samePlacement(plannerPlacement, effectiveQuery),
    });
  }

  if (evidence.kind === "EXPLICIT_REGION") {
    const effectiveQuery = explicitRegionQuery(evidence);
    return placement({
      mode: "EXPLICIT_REGION",
      provenance: plannerPlacement === undefined || !samePlacement(plannerPlacement, effectiveQuery)
        ? "TRANSCRIPT_RECOVERED"
        : "PLANNER_EXPLICIT",
      choicePolicy: "EXPLICIT_REGION",
      effectiveQuery,
      evidence,
      plannerPlacementPresent,
      conflictRecovered: plannerPlacement !== undefined
        && !samePlacement(plannerPlacement, effectiveQuery),
    });
  }

  if (evidence.kind === "CONTEXTUAL_RELATIVE") {
    const effectiveQuery = contextualQuery(evidence, plannerPlacement, context);
    const conflictRecovered = plannerPlacement !== undefined
      && !samePlacement(plannerPlacement, effectiveQuery);
    return placement({
      mode: effectiveQuery.reference.kind === "PAGE"
        || effectiveQuery.reference.kind === "VIEWPORT"
        ? "EXPLICIT_REGION"
        : "CONTEXTUAL_RELATIVE",
      provenance: plannerPlacement === undefined || conflictRecovered
        ? "TRANSCRIPT_RECOVERED"
        : "PLANNER_EXPLICIT",
      choicePolicy: effectiveQuery.reference.kind === "PAGE"
        || effectiveQuery.reference.kind === "VIEWPORT"
        ? "EXPLICIT_REGION"
        : "SEMANTIC_CONSTRAINT_REQUIRED",
      effectiveQuery,
      evidence,
      plannerPlacementPresent,
      conflictRecovered,
    });
  }

  if (plannerPlacement !== undefined && !isGenericUnanchoredPlacement(plannerPlacement)) {
    const mode = modeFromPlannerPlacement(plannerPlacement);
    return placement({
      mode,
      provenance: "PLANNER_EXPLICIT",
      choicePolicy: choicePolicyForMode(mode, plannerPlacement),
      effectiveQuery: plannerPlacement,
      evidence,
      plannerPlacementPresent,
      conflictRecovered: false,
    });
  }

  const autoFlow = resolveAutoFlow(context);
  return placement({
    mode: "AUTO_FLOW",
    provenance: autoFlow.source === "PAGE_ORIGIN"
      ? "SYSTEM_DEFAULT"
      : "CONTEXT_INFERRED",
    choicePolicy: "WRITING_FLOW",
    effectiveQuery: autoFlow.query,
    evidence,
    plannerPlacementPresent,
    conflictRecovered: false,
    autoFlowSource: autoFlow.source,
    ...(plannerPlacement === undefined
      ? { recoveryReason: "MISSING_PLACEMENT_QUERY" as const }
      : { recoveryReason: "GENERIC_PLANNER_PLACEMENT_DEFAULTED" as const }),
  });
}

function placement(input: {
  readonly mode: TextPlacementMode;
  readonly provenance: TextPlacementProvenance;
  readonly choicePolicy: TextPlacementChoicePolicy;
  readonly effectiveQuery: SpatialPlacementQuery;
  readonly evidence: SpatialPhraseEvidence;
  readonly plannerPlacementPresent: boolean;
  readonly conflictRecovered: boolean;
  readonly autoFlowSource?: TextPlacementAutoFlowSource;
  readonly recoveryReason?: TextPlacementRecoveryReason;
}): NormalizedTextPlacement {
  const recoveryReason = input.recoveryReason
    ?? (input.conflictRecovered
      ? "PLACEMENT_CONFLICT_RECOVERED"
      : !input.plannerPlacementPresent
        ? "MISSING_PLACEMENT_QUERY"
        : undefined);
  return Object.freeze({
    mode: input.mode,
    provenance: input.provenance,
    choicePolicy: input.choicePolicy,
    effectiveQuery: freezeQuery(input.effectiveQuery),
    plannerPlacementPresent: input.plannerPlacementPresent,
    evidenceKind: input.evidence.kind,
    evidenceTokens: Object.freeze([...input.evidence.tokens]),
    conflictRecovered: input.conflictRecovered,
    recoveryApplied: recoveryReason !== undefined,
    ...(recoveryReason === undefined ? {} : { recoveryReason }),
    ...(input.autoFlowSource === undefined
      ? {}
      : { autoFlowSource: input.autoFlowSource }),
  });
}

function explicitRegionQuery(
  evidence: Extract<SpatialPhraseEvidence, { kind: "EXPLICIT_REGION" }>,
): SpatialPlacementQuery {
  const regionHint = regionHintFromAxes(evidence.horizontal, evidence.vertical);
  return {
    reference: { kind: evidence.scope === "CURRENT_VIEW" ? "VIEWPORT" : "PAGE" },
    relation: "FREE_SPACE",
    ...(regionHint === undefined ? {} : { regionHint }),
    alignment: alignmentFromHorizontal(evidence.horizontal),
    overlayIntent: "NONE",
  };
}

function contextualQuery(
  evidence: Extract<SpatialPhraseEvidence, { kind: "CONTEXTUAL_RELATIVE" }>,
  plannerPlacement: SpatialPlacementQuery | undefined,
  context: DirectCommandContext,
): SpatialPlacementQuery {
  if (plannerPlacement?.reference.kind === "TARGET") {
    if (plannerPlacement.relation === evidence.relation) return plannerPlacement;
    return {
      ...plannerPlacement,
      relation: evidence.relation,
      ...(evidence.relation === "NEAR" ? { distance: "NEAR" as const } : {}),
    };
  }
  if (
    plannerPlacement?.reference.kind === "FOCUS"
    && plannerPlacement.relation === evidence.relation
  ) {
    return plannerPlacement;
  }
  if (evidence.objectType !== undefined) {
    return relativeQuery({
      kind: "TARGET",
      query: {
        kind: "object",
        objectType: evidence.objectType,
        ...(evidence.deictic ? { relation: "last_target" as const } : {}),
      },
    }, evidence.relation);
  }
  if (hasUsableFocus(context)) {
    return relativeQuery({ kind: "FOCUS" }, evidence.relation);
  }
  if (evidence.deictic) {
    return relativeQuery({
      kind: "TARGET",
      query: { kind: "relative", relation: "last_target" },
    }, evidence.relation);
  }
  return absoluteDirectionalQuery(evidence.relation, evidence.scope);
}

function relativeQuery(
  reference: SpatialReferenceQuery,
  relation: Extract<SpatialPlacementQuery["relation"], "ABOVE" | "BELOW" | "LEFT_OF" | "RIGHT_OF" | "NEAR">,
): SpatialPlacementQuery {
  return {
    reference,
    relation,
    alignment: "START",
    distance: relation === "NEAR" ? "NEAR" : "NORMAL",
    overlayIntent: "NONE",
  };
}

function absoluteDirectionalQuery(
  relation: Extract<SpatialPlacementQuery["relation"], "ABOVE" | "BELOW" | "LEFT_OF" | "RIGHT_OF" | "NEAR">,
  scope: "PAGE" | "CURRENT_VIEW",
): SpatialPlacementQuery {
  const regionHint: SpatialRegionHint | undefined = relation === "ABOVE"
    ? "TOP"
    : relation === "BELOW"
      ? "BOTTOM"
      : relation === "LEFT_OF"
        ? "LEFT"
        : relation === "RIGHT_OF"
          ? "RIGHT"
          : undefined;
  return {
    reference: { kind: scope === "CURRENT_VIEW" ? "VIEWPORT" : "PAGE" },
    relation: "FREE_SPACE",
    ...(regionHint === undefined ? {} : { regionHint }),
    alignment: relation === "RIGHT_OF" ? "END" : "START",
    overlayIntent: "NONE",
  };
}

function autoFreeSpaceQuery(scope: "PAGE" | "CURRENT_VIEW"): SpatialPlacementQuery {
  return {
    reference: { kind: scope === "CURRENT_VIEW" ? "VIEWPORT" : "PAGE" },
    relation: "FREE_SPACE",
    ...(scope === "CURRENT_VIEW" ? { regionHint: "CURRENT_VIEW" as const } : {}),
    alignment: "AUTO",
    overlayIntent: "NONE",
  };
}

function resolveAutoFlow(context: DirectCommandContext): {
  readonly source: TextPlacementAutoFlowSource;
  readonly query: SpatialPlacementQuery;
} {
  if (hasUsableFocus(context)) {
    return {
      source: "FOCUS",
      query: relativeQuery({ kind: "FOCUS" }, "BELOW"),
    };
  }
  if (hasTrustedLastText(context)) {
    return {
      source: "LAST_TEXT",
      query: relativeQuery({
        kind: "TARGET",
        query: { kind: "object", objectType: "text", relation: "recent" },
      }, "BELOW"),
    };
  }
  return {
    source: "PAGE_ORIGIN",
    query: {
      reference: { kind: "PAGE" },
      relation: "FREE_SPACE",
      regionHint: "TOP",
      alignment: "START",
      overlayIntent: "NONE",
    },
  };
}

function hasUsableFocus(context: DirectCommandContext): boolean {
  return !context.frozenContext.focusStale
    && (context.frozenContext.focusObjectId !== undefined
      || context.frozenContext.focusBounds !== undefined);
}

function hasTrustedLastText(context: DirectCommandContext): boolean {
  const previous = context.historySnapshot?.lastSuccessfulOperation;
  if (
    previous?.command.capability !== "text"
    || previous.command.operation !== "create"
    || previous.editorAnnotationId === undefined
    || previous.editorOperationId === undefined
  ) {
    return false;
  }
  const operationStillCurrent = context.recentOperations.some(
    (operation) => operation.operationId === previous.editorOperationId,
  );
  const targetStillExists = context.pageTargetCatalog.candidates.some(
    (candidate) => candidate.sceneObjectId === previous.editorAnnotationId
      && candidate.type === "text",
  );
  return operationStillCurrent && targetStillExists;
}

function isGenericUnanchoredPlacement(query: SpatialPlacementQuery): boolean {
  return (query.reference.kind === "PAGE" || query.reference.kind === "VIEWPORT")
    && query.relation === "FREE_SPACE"
    && query.regionHint === undefined;
}

function modeFromPlannerPlacement(query: SpatialPlacementQuery): TextPlacementMode {
  if (query.reference.kind === "TARGET" || query.reference.kind === "FOCUS") {
    return "CONTEXTUAL_RELATIVE";
  }
  return query.regionHint === undefined ? "AUTO_FREE_SPACE" : "EXPLICIT_REGION";
}

function choicePolicyForMode(
  mode: TextPlacementMode,
  query: SpatialPlacementQuery,
): TextPlacementChoicePolicy {
  if (mode === "AUTO_FLOW") return "WRITING_FLOW";
  if (mode === "AUTO_FREE_SPACE") return "USER_DELEGATED_LAYOUT";
  if (mode === "EXPLICIT_REGION") return "EXPLICIT_REGION";
  return query.reference.kind === "TARGET" || query.reference.kind === "FOCUS"
    ? "SEMANTIC_CONSTRAINT_REQUIRED"
    : "EXPLICIT_REGION";
}

function regionHintFromAxes(
  horizontal: HorizontalPlacementEvidence | undefined,
  vertical: VerticalPlacementEvidence | undefined,
): SpatialRegionHint | undefined {
  if (vertical === "TOP") return "TOP";
  if (vertical === "BOTTOM") return "BOTTOM";
  if (horizontal === "LEFT") return "LEFT";
  if (horizontal === "RIGHT") return "RIGHT";
  return undefined;
}

function alignmentFromHorizontal(
  horizontal: HorizontalPlacementEvidence | undefined,
): SpatialAlignment {
  if (horizontal === "RIGHT") return "END";
  if (horizontal === "CENTER") return "CENTER";
  return "START";
}

function samePlacement(
  left: SpatialPlacementQuery,
  right: SpatialPlacementQuery,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function freezeQuery(query: SpatialPlacementQuery): SpatialPlacementQuery {
  const reference = query.reference.kind === "TARGET"
    ? Object.freeze({ ...query.reference, query: Object.freeze({ ...query.reference.query }) })
    : Object.freeze({ ...query.reference });
  return Object.freeze({ ...query, reference });
}

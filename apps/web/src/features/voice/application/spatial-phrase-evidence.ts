import type { DirectTargetObjectType } from "../domain";

export type HorizontalPlacementEvidence = "LEFT" | "CENTER" | "RIGHT";
export type VerticalPlacementEvidence = "TOP" | "CENTER" | "BOTTOM";

export type SpatialPhraseEvidence =
  | {
      readonly kind: "NONE";
      readonly tokens: readonly string[];
    }
  | {
      readonly kind: "AUTO_FREE_SPACE";
      readonly scope: "PAGE" | "CURRENT_VIEW";
      readonly tokens: readonly string[];
    }
  | {
      readonly kind: "EXPLICIT_REGION";
      readonly horizontal?: HorizontalPlacementEvidence;
      readonly vertical?: VerticalPlacementEvidence;
      readonly scope: "PAGE" | "CURRENT_VIEW";
      readonly tokens: readonly string[];
    }
  | {
      readonly kind: "CONTEXTUAL_RELATIVE";
      readonly relation: "ABOVE" | "BELOW" | "LEFT_OF" | "RIGHT_OF" | "NEAR";
      readonly deictic: boolean;
      readonly objectType?: DirectTargetObjectType;
      readonly scope: "PAGE" | "CURRENT_VIEW";
      readonly tokens: readonly string[];
    };

export interface SpatialPhraseEvidenceInput {
  readonly transcript: string;
  readonly content: string;
  readonly hasFocus: boolean;
}

const FREE_SPACE_PATTERN = /빈\s*(?:공간|곳)(?:에|으로)|여백(?:에|으로)|안\s*겹치는\s*곳(?:에|으로)|적당한\s*곳(?:에|으로)|아무\s*데나/gu;
const REGION_PATTERN = /(?:(왼쪽|왼편|좌측|오른쪽|오른편|우측|가운데|중앙)\s*)?(위쪽|상단|위|아래쪽|밑|하단|아래)?\s*(?:쪽)?(?:에|으로|에서)/gu;
const REVERSED_REGION_PATTERN = /(위쪽|상단|위|아래쪽|밑|하단|아래)\s*(왼쪽|왼편|좌측|오른쪽|오른편|우측|가운데|중앙)\s*(?:쪽)?(?:에|으로|에서)/gu;
const NEAR_PATTERN = /(옆|근처)\s*(?:에|로|으로)/gu;
const CURRENT_VIEW_PATTERN = /현재\s*(?:화면|뷰)|화면/gu;
const PAGE_PATTERN = /현재\s*페이지|페이지/gu;
const DEICTIC_PATTERN = /(?:^|\s|["'])((?:이|그|저)|여기|거기)\s*$/u;

const OBJECT_TERMS: ReadonlyArray<readonly [RegExp, DirectTargetObjectType]> = [
  [/그림|이미지/u, "image"],
  [/표/u, "table"],
  [/그래프/u, "graph"],
  [/수식/u, "math"],
  [/텍스트|글|메모/u, "text"],
];

/**
 * Conservative Korean placement grammar. The planner-owned content is masked
 * before matching so text such as "왼쪽 위라고 써 줘" remains content rather
 * than becoming executable placement evidence.
 */
export function extractSpatialPhraseEvidence(
  input: SpatialPhraseEvidenceInput,
): SpatialPhraseEvidence {
  const transcript = maskPlannerContent(input.transcript, input.content);
  const scope = resolveScope(transcript);
  const freeSpace = firstMatch(transcript, FREE_SPACE_PATTERN);
  if (freeSpace !== undefined) {
    return {
      kind: "AUTO_FREE_SPACE",
      scope,
      tokens: Object.freeze([freeSpace[0].trim()]),
    };
  }

  const reversed = firstMatch(transcript, REVERSED_REGION_PATTERN);
  if (reversed !== undefined) {
    return explicitOrRelative({
      transcript,
      match: reversed,
      horizontalTerm: reversed[2],
      verticalTerm: reversed[1],
      scope,
      hasFocus: input.hasFocus,
    });
  }
  const region = firstMeaningfulRegionMatch(transcript);
  if (region !== undefined) {
    return explicitOrRelative({
      transcript,
      match: region,
      horizontalTerm: region[1],
      verticalTerm: region[2],
      scope,
      hasFocus: input.hasFocus,
    });
  }
  const near = firstMatch(transcript, NEAR_PATTERN);
  if (near !== undefined) {
    const prefix = transcript.slice(Math.max(0, near.index - 24), near.index);
    return {
      kind: "CONTEXTUAL_RELATIVE",
      relation: "NEAR",
      deictic: hasDeictic(prefix),
      ...(findObjectType(prefix) === undefined
        ? {}
        : { objectType: findObjectType(prefix) }),
      scope,
      tokens: Object.freeze([near[1] ?? near[0].trim()]),
    };
  }
  return { kind: "NONE", tokens: Object.freeze([]) };
}

function explicitOrRelative(input: {
  readonly transcript: string;
  readonly match: RegExpExecArray;
  readonly horizontalTerm?: string;
  readonly verticalTerm?: string;
  readonly scope: "PAGE" | "CURRENT_VIEW";
  readonly hasFocus: boolean;
}): Exclude<SpatialPhraseEvidence, { kind: "NONE" | "AUTO_FREE_SPACE" }> {
  const horizontal = horizontalEvidence(input.horizontalTerm);
  const vertical = verticalEvidence(input.verticalTerm);
  const prefix = input.transcript.slice(
    Math.max(0, input.match.index - 24),
    input.match.index,
  );
  const deictic = hasDeictic(prefix);
  const objectType = findObjectType(prefix);
  const tokens = Object.freeze([
    ...(input.horizontalTerm === undefined ? [] : [input.horizontalTerm]),
    ...(input.verticalTerm === undefined ? [] : [input.verticalTerm]),
  ]);

  if (horizontal !== undefined && vertical !== undefined) {
    return { kind: "EXPLICIT_REGION", horizontal, vertical, scope: input.scope, tokens };
  }
  if (deictic || objectType !== undefined || input.hasFocus) {
    return {
      kind: "CONTEXTUAL_RELATIVE",
      relation: relationFromAxes(horizontal, vertical),
      deictic,
      ...(objectType === undefined ? {} : { objectType }),
      scope: input.scope,
      tokens,
    };
  }
  return {
    kind: "EXPLICIT_REGION",
    ...(horizontal === undefined ? {} : { horizontal }),
    ...(vertical === undefined ? {} : { vertical }),
    scope: input.scope,
    tokens,
  };
}

function firstMeaningfulRegionMatch(value: string): RegExpExecArray | undefined {
  REGION_PATTERN.lastIndex = 0;
  for (let match = REGION_PATTERN.exec(value); match !== null; match = REGION_PATTERN.exec(value)) {
    if (match[1] !== undefined || match[2] !== undefined) return match;
  }
  return undefined;
}

function firstMatch(value: string, pattern: RegExp): RegExpExecArray | undefined {
  pattern.lastIndex = 0;
  return pattern.exec(value) ?? undefined;
}

function maskPlannerContent(transcript: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return transcript;
  return transcript.split(trimmed).join(" ".repeat(trimmed.length));
}

function resolveScope(value: string): "PAGE" | "CURRENT_VIEW" {
  CURRENT_VIEW_PATTERN.lastIndex = 0;
  if (CURRENT_VIEW_PATTERN.test(value)) return "CURRENT_VIEW";
  PAGE_PATTERN.lastIndex = 0;
  return PAGE_PATTERN.test(value) ? "PAGE" : "PAGE";
}

function hasDeictic(prefix: string): boolean {
  return DEICTIC_PATTERN.test(prefix.trimEnd());
}

function findObjectType(prefix: string): DirectTargetObjectType | undefined {
  for (const [pattern, objectType] of OBJECT_TERMS) {
    if (pattern.test(prefix)) return objectType;
  }
  return undefined;
}

function horizontalEvidence(value: string | undefined): HorizontalPlacementEvidence | undefined {
  if (value === undefined) return undefined;
  if (/왼쪽|왼편|좌측/u.test(value)) return "LEFT";
  if (/오른쪽|오른편|우측/u.test(value)) return "RIGHT";
  return "CENTER";
}

function verticalEvidence(value: string | undefined): VerticalPlacementEvidence | undefined {
  if (value === undefined) return undefined;
  if (/위쪽|상단|위/u.test(value)) return "TOP";
  if (/아래쪽|밑|하단|아래/u.test(value)) return "BOTTOM";
  return "CENTER";
}

function relationFromAxes(
  horizontal: HorizontalPlacementEvidence | undefined,
  vertical: VerticalPlacementEvidence | undefined,
): "ABOVE" | "BELOW" | "LEFT_OF" | "RIGHT_OF" | "NEAR" {
  if (vertical === "TOP") return "ABOVE";
  if (vertical === "BOTTOM") return "BELOW";
  if (horizontal === "LEFT") return "LEFT_OF";
  if (horizontal === "RIGHT") return "RIGHT_OF";
  return "NEAR";
}

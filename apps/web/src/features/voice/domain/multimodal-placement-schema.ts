import {
  SPATIAL_ALIGNMENTS,
  SPATIAL_PLACEMENT_RELATIONS,
} from "./spatial-placement-query";
import {
  MultimodalPlacementValidationError,
  type MultimodalPlacementAnchorSummary,
  type MultimodalPlacementCandidateSummary,
  type MultimodalPlacementChoice,
  type MultimodalPlacementDraftSummary,
  type MultimodalPlacementRequest,
  type PlacementCandidateAlias,
} from "./multimodal-placement-types";

export const MULTIMODAL_PLACEMENT_LIMITS = Object.freeze({
  observationIdChars: 240,
  pageIdChars: 240,
  instructionChars: 500,
  summaryChars: 180,
  kindChars: 80,
  imageDataUrlChars: 12_000_000,
  candidates: 6,
});

const CANDIDATE_STRATEGIES = [
  "ANCHOR_RELATIVE",
  "REGION_SLOT",
  "FREE_SPACE",
  "OVERFLOW",
] as const;
const CLEARANCE_CATEGORIES = ["LOW", "MEDIUM", "HIGH"] as const;
const SOFT_OVERLAP_CATEGORIES = ["NONE", "LOW", "PRESENT"] as const;
const ANCHOR_KINDS = ["OBJECT", "FOCUS", "PAGE", "VIEWPORT"] as const;
const FIT_VALUES = ["PREFERRED", "COMPACT"] as const;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u;
const ALIAS = /^S[1-9][0-9]*$/u;

export function parseMultimodalPlacementRequest(
  value: unknown,
): MultimodalPlacementRequest {
  const record = strictRecord(value, "request", [
    "observationId",
    "pageId",
    "sceneRevision",
    "instruction",
    "draft",
    "anchor",
    "candidates",
    "images",
  ]);
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2
    || candidates.length > MULTIMODAL_PLACEMENT_LIMITS.candidates) {
    invalid("request.candidates", "Expected between 2 and 6 candidates.");
  }
  const parsedCandidates = candidates.map((candidate, index) =>
    parseCandidate(candidate, `request.candidates[${index}]`));
  const aliases = parsedCandidates.map((candidate) => candidate.alias);
  if (new Set(aliases).size !== aliases.length) {
    invalid("request.candidates", "Candidate aliases must be unique.");
  }
  const images = strictRecord(record.images, "request.images", [
    "globalOverview",
    "localCandidateCrop",
  ]);
  return {
    observationId: boundedString(
      record.observationId,
      "request.observationId",
      MULTIMODAL_PLACEMENT_LIMITS.observationIdChars,
    ),
    pageId: boundedString(
      record.pageId,
      "request.pageId",
      MULTIMODAL_PLACEMENT_LIMITS.pageIdChars,
    ),
    sceneRevision: nonNegativeInteger(
      record.sceneRevision,
      "request.sceneRevision",
    ),
    instruction: boundedString(
      record.instruction,
      "request.instruction",
      MULTIMODAL_PLACEMENT_LIMITS.instructionChars,
    ),
    draft: parseDraft(record.draft),
    ...(record.anchor === undefined
      ? {}
      : { anchor: parseAnchor(record.anchor) }),
    candidates: Object.freeze(parsedCandidates),
    images: Object.freeze({
      globalOverview: imageDataUrl(
        images.globalOverview,
        "request.images.globalOverview",
      ),
      localCandidateCrop: imageDataUrl(
        images.localCandidateCrop,
        "request.images.localCandidateCrop",
      ),
    }),
  };
}

export function parseMultimodalPlacementChoice(
  value: unknown,
  aliases: readonly PlacementCandidateAlias[],
): MultimodalPlacementChoice {
  const record = strictRecord(value, "choice", ["choice"]);
  const choice = record.choice;
  if (choice === "NONE") return { choice };
  if (typeof choice !== "string" || !ALIAS.test(choice)
    || !aliases.includes(choice as PlacementCandidateAlias)) {
    invalid("choice.choice", "Expected NONE or a current candidate alias.");
  }
  return { choice: choice as PlacementCandidateAlias };
}

function parseDraft(value: unknown): MultimodalPlacementDraftSummary {
  const record = strictRecord(value, "request.draft", ["kind", "contentSummary"]);
  return {
    kind: boundedString(
      record.kind,
      "request.draft.kind",
      MULTIMODAL_PLACEMENT_LIMITS.kindChars,
    ),
    ...(record.contentSummary === undefined
      ? {}
      : {
          contentSummary: boundedString(
            record.contentSummary,
            "request.draft.contentSummary",
            MULTIMODAL_PLACEMENT_LIMITS.summaryChars,
          ),
        }),
  };
}

function parseAnchor(value: unknown): MultimodalPlacementAnchorSummary {
  const record = strictRecord(value, "request.anchor", [
    "kind",
    "semanticRole",
    "textSummary",
  ]);
  return {
    kind: enumValue(record.kind, ANCHOR_KINDS, "request.anchor.kind"),
    ...(record.semanticRole === undefined
      ? {}
      : {
          semanticRole: boundedString(
            record.semanticRole,
            "request.anchor.semanticRole",
            MULTIMODAL_PLACEMENT_LIMITS.kindChars,
          ),
        }),
    ...(record.textSummary === undefined
      ? {}
      : {
          textSummary: boundedString(
            record.textSummary,
            "request.anchor.textSummary",
            MULTIMODAL_PLACEMENT_LIMITS.summaryChars,
          ),
        }),
  };
}

function parseCandidate(
  value: unknown,
  path: string,
): MultimodalPlacementCandidateSummary {
  const record = strictRecord(value, path, [
    "alias",
    "relation",
    "alignment",
    "fit",
    "strategy",
    "clearance",
    "softOverlap",
    "regionMatch",
  ]);
  if (typeof record.alias !== "string" || !ALIAS.test(record.alias)) {
    invalid(`${path}.alias`, "Expected an S-number alias.");
  }
  if (typeof record.regionMatch !== "boolean") {
    invalid(`${path}.regionMatch`, "Expected a boolean.");
  }
  return {
    alias: record.alias as PlacementCandidateAlias,
    relation: enumValue(record.relation, SPATIAL_PLACEMENT_RELATIONS, `${path}.relation`),
    alignment: enumValue(record.alignment, SPATIAL_ALIGNMENTS, `${path}.alignment`),
    fit: enumValue(record.fit, FIT_VALUES, `${path}.fit`),
    strategy: enumValue(record.strategy, CANDIDATE_STRATEGIES, `${path}.strategy`),
    clearance: enumValue(record.clearance, CLEARANCE_CATEGORIES, `${path}.clearance`),
    softOverlap: enumValue(record.softOverlap, SOFT_OVERLAP_CATEGORIES, `${path}.softOverlap`),
    regionMatch: record.regionMatch,
  };
}

function strictRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid(path, "Expected a plain object.");
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !allowedKeys.includes(key));
  if (unknown !== undefined) invalid(`${path}.${unknown}`, "Unknown field.");
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== "string") invalid(path, "Expected a string.");
  const compact = value.trim().replace(/\s+/gu, " ");
  if (compact.length === 0 || compact.length > maxChars) {
    invalid(path, `Expected 1 to ${maxChars} characters.`);
  }
  return compact;
}

function imageDataUrl(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0
    || value.length > MULTIMODAL_PLACEMENT_LIMITS.imageDataUrlChars
    || !IMAGE_DATA_URL.test(value)) {
    invalid(path, "Expected a bounded PNG, JPEG, or WebP data URL.");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    invalid(path, "Expected a non-negative integer.");
  }
  return value as number;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    invalid(path, "Unexpected enum value.");
  }
  return value as T[number];
}

function invalid(path: string, message: string): never {
  throw new MultimodalPlacementValidationError(message, path);
}

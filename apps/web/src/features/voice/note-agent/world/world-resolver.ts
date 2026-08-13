import {
  normalizeSceneObjectText,
  type Rect,
  type SceneObjectMetadataView,
} from "@ggulnote/editor-core";
import {
  FrozenTargetResolver,
} from "../../application";
import type {
  DirectRecentOperation,
  DirectCommandContext,
  DirectReusableTargetRecord,
  FrozenVoiceTurnContext,
  PageTargetCatalog,
  SpeechGroundingEvidence,
  TargetQuery,
  TargetResolutionInput,
  TargetResolutionResult,
} from "../../domain";
import type {
  EntitySelector,
  NotePageRegion,
  NoteSpatialRelation,
  SpatialConstraint,
  SpatialReference,
} from "../domain";
import type { EntityRef } from "./entity-ref";
import type { ObjectIndexEntry, ObjectIndexQuery } from "./object-index";
import type { UnifiedObjectWorld } from "./unified-object-world";
import { DeterministicPartResolver } from "./part-resolver";

const MAX_COMPACT_CANDIDATES = 4;

export interface FrozenWorldContext {
  readonly documentId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly frozenVoiceContext: FrozenVoiceTurnContext;
  readonly catalog: PageTargetCatalog;
  readonly recentOperations: readonly DirectRecentOperation[];
  readonly selection?: EntityRef;
  readonly focus?: EntityRef;
  readonly speechGroundingEvidence?: SpeechGroundingEvidence;
  readonly lastReusableTarget?: DirectReusableTargetRecord;
  readonly directContext?: DirectCommandContext;
}

export interface WorldResolutionCandidate {
  readonly label: `C${number}`;
  readonly ref: EntityRef;
  readonly kind?: string;
  readonly source?: string;
  readonly textPreview?: string;
}

export type WorldResolutionResult =
  | { readonly status: "RESOLVED"; readonly ref: EntityRef }
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly WorldResolutionCandidate[] }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string };

export interface ExistingWorldResolverOptions {
  readonly world: UnifiedObjectWorld;
  readonly targetResolver?: FrozenTargetResolver;
  readonly partResolver?: DeterministicPartResolver;
}

export class ExistingWorldResolver {
  private readonly targetResolver: FrozenTargetResolver;
  private readonly partResolver: DeterministicPartResolver;

  public constructor(private readonly options: ExistingWorldResolverOptions) {
    this.targetResolver = options.targetResolver ?? new FrozenTargetResolver();
    this.partResolver = options.partResolver ?? new DeterministicPartResolver();
  }

  public async resolve(
    selector: EntitySelector,
    context: FrozenWorldContext,
  ): Promise<WorldResolutionResult> {
    return this.resolveAtDepth(selector, context, 0);
  }

  private async resolveAtDepth(
    selector: EntitySelector,
    context: FrozenWorldContext,
    depth: number,
  ): Promise<WorldResolutionResult> {
    if (depth > 2) return { status: "UNSUPPORTED", reasonCode: "SELECTOR_DEPTH" };
    if (selector.part !== undefined) {
      const { part, ...parentSelector } = selector;
      const parent = await this.resolveAtDepth(parentSelector, context, depth);
      if (parent.status !== "RESOLVED") return parent;
      return this.partResolver.resolve(parent.ref, part, this.options.world);
    }
    const scene = this.options.world.getSnapshot(context.pageId, context.sceneRevision);
    if (
      scene === undefined
      || scene.page.id !== context.pageId
      || scene.sceneRevision !== context.sceneRevision
    ) {
      return { status: "UNSUPPORTED", reasonCode: "STALE_SCENE" };
    }

    const hasExplicitTarget = hasExplicitTargetConstraint(selector);
    if (!hasExplicitTarget && selector.context !== undefined) {
      return this.resolveContext(selector.context, context);
    }
    if (!hasExplicitTarget && selector.temporal === "RECENT") {
      return this.resolveRecent(selector, context);
    }

    let entries = this.searchIndex(selector, context);
    if (selector.spatial !== undefined && entries.length > 0) {
      const spatial = await this.filterSpatial(
        entries,
        selector.spatial,
        context,
        depth,
      );
      if (spatial.status !== "RESOLVED") return spatial;
      entries = spatial.entries;
    }
    entries = applyOrdering(entries, selector);
    const selected = selectOrdinal(entries, selector.ordinal, selector.temporal);
    if (selected !== undefined) return { status: "RESOLVED", ref: objectRef(selected) };
    if (entries.length === 1) return { status: "RESOLVED", ref: objectRef(entries[0]) };
    if (entries.length > 1) return ambiguousFromEntries(entries, this.options.world);

    const targetQuery = toTargetQuery(selector);
    if (targetQuery === undefined) return { status: "NOT_FOUND" };
    const grounded = await this.targetResolver.resolveAsync(
      targetResolutionInput(targetQuery, context),
    );
    return mapTargetResolution(grounded);
  }

  private searchIndex(
    selector: EntitySelector,
    context: FrozenWorldContext,
  ): readonly ObjectIndexEntry[] {
    const query: ObjectIndexQuery = {
      documentId: context.documentId,
      ...(selector.scope === "DOCUMENT" ? {} : { pageId: context.pageId }),
      ...(selector.scope === "DOCUMENT" ? {} : { sceneRevision: context.sceneRevision }),
      ...(selector.kinds === undefined ? {} : { kinds: selector.kinds }),
      ...sourceQuery(selector),
      ...(selector.content?.text === undefined ? {} : { text: selector.content.text }),
      ...(selector.content?.math === undefined
        ? {}
        : { canonicalMath: selector.content.math }),
      ...(selector.attributes === undefined
        ? {}
        : { semanticAttributes: selector.attributes }),
      sort: sortFor(selector),
    };
    return this.options.world.searchIndex(query);
  }

  private resolveContext(
    requested: "FOCUS" | "SELECTION",
    context: FrozenWorldContext,
  ): WorldResolutionResult {
    const ref = requested === "FOCUS" ? context.focus : context.selection;
    return ref === undefined ? { status: "NOT_FOUND" } : { status: "RESOLVED", ref };
  }

  private resolveRecent(
    selector: EntitySelector,
    context: FrozenWorldContext,
  ): WorldResolutionResult {
    const refs = this.options.world.getRecentOperationOutputs({
      pageId: selector.scope === "DOCUMENT" ? undefined : context.pageId,
      limit: 6,
    }).filter((ref) => refMatchesSelector(ref, selector, this.options.world));
    const ref = refs[0];
    return ref === undefined ? { status: "NOT_FOUND" } : { status: "RESOLVED", ref };
  }

  private async filterSpatial(
    entries: readonly ObjectIndexEntry[],
    constraints: readonly SpatialConstraint[],
    context: FrozenWorldContext,
    depth: number,
  ): Promise<
    | { readonly status: "RESOLVED"; readonly entries: readonly ObjectIndexEntry[] }
    | Exclude<WorldResolutionResult, { status: "RESOLVED" }>
  > {
    let filtered = entries;
    for (const constraint of constraints) {
      if (constraint.relation === "BETWEEN") {
        return { status: "UNSUPPORTED", reasonCode: "BETWEEN_REQUIRES_TWO_REFERENCES" };
      }
      const relation = constraint.relation;
      const reference = await this.resolveSpatialReference(
        constraint.reference,
        context,
        depth,
      );
      if (reference.status !== "RESOLVED") return reference;
      filtered = filtered.filter((entry) => {
        const bounds = this.options.world.getObjectMetadata(entry.objectId)?.renderBounds;
        return bounds !== undefined && matchesRelation(
          bounds,
          reference.bounds,
          relation,
        );
      });
    }
    return { status: "RESOLVED", entries: filtered };
  }

  private async resolveSpatialReference(
    reference: SpatialReference,
    context: FrozenWorldContext,
    depth: number,
  ): Promise<
    | { readonly status: "RESOLVED"; readonly bounds: Rect }
    | Exclude<WorldResolutionResult, { status: "RESOLVED" }>
  > {
    if (reference.kind === "PAGE_REGION") {
      if (reference.region === "MARGIN") {
        return { status: "UNSUPPORTED", reasonCode: "MARGIN_SEARCH_UNSUPPORTED" };
      }
      const scene = this.options.world.getSnapshot(context.pageId, context.sceneRevision);
      return scene === undefined
        ? { status: "UNSUPPORTED", reasonCode: "STALE_SCENE" }
        : {
            status: "RESOLVED",
            bounds: pageRegionBounds(
              { x: 0, y: 0, width: scene.page.width, height: scene.page.height },
              reference.region,
            ),
          };
    }
    if (reference.kind === "FOCUS" || reference.kind === "SELECTION") {
      const result = this.resolveContext(reference.kind, context);
      return result.status === "RESOLVED"
        ? boundsForRef(result.ref, this.options.world)
        : result;
    }
    const result = await this.resolveAtDepth(reference.selector, context, depth + 1);
    return result.status === "RESOLVED"
      ? boundsForRef(result.ref, this.options.world)
      : result;
  }
}

function hasExplicitTargetConstraint(selector: EntitySelector): boolean {
  return selector.kinds !== undefined
    || (selector.source !== undefined && selector.source !== "ANY")
    || selector.content !== undefined
    || selector.attributes !== undefined
    || selector.spatial !== undefined
    || (selector.temporal !== undefined && selector.temporal !== "RECENT")
    || selector.ordinal !== undefined;
}

function sourceQuery(selector: EntitySelector): Pick<ObjectIndexQuery, "sources"> {
  if (selector.source === "PDF_BASE") return { sources: ["PDF_BASE"] };
  if (selector.source === "USER_CREATED") {
    return { sources: ["USER_CANVAS", "USER_ANNOTATION"] };
  }
  return {};
}

function sortFor(selector: EntitySelector): ObjectIndexQuery["sort"] {
  if (selector.temporal === "RECENT" || selector.temporal === "LAST_CREATED") {
    return "CREATION_DESC";
  }
  if (selector.temporal === "FIRST_CREATED" || selector.ordinal !== undefined) {
    return "CREATION_ASC";
  }
  return "READING_ORDER";
}

function applyOrdering(
  entries: readonly ObjectIndexEntry[],
  selector: EntitySelector,
): readonly ObjectIndexEntry[] {
  if (selector.content?.semantic === undefined) return entries;
  const semantic = normalizeSceneObjectText(selector.content.semantic);
  return entries.filter((entry) => entry.normalizedText?.includes(semantic) === true);
}

function selectOrdinal(
  entries: readonly ObjectIndexEntry[],
  ordinal: EntitySelector["ordinal"],
  temporal: EntitySelector["temporal"],
): ObjectIndexEntry | undefined {
  if (entries.length === 0) return undefined;
  if (temporal === "RECENT" || temporal === "FIRST_CREATED" || temporal === "LAST_CREATED") {
    return entries[0];
  }
  if (ordinal === "FIRST") return entries[0];
  if (ordinal === "LAST") return entries.at(-1);
  if (typeof ordinal === "number") return entries[ordinal - 1];
  return undefined;
}

function toTargetQuery(selector: EntitySelector): TargetQuery | undefined {
  const startAnchor = selector.attributes?.startAnchor;
  const endAnchor = selector.attributes?.endAnchor;
  if (typeof startAnchor === "string" && typeof endAnchor === "string") {
    return { kind: "text_span", startAnchor, endAnchor };
  }
  if (selector.content?.semantic !== undefined) {
    const unit = selector.attributes?.unit;
    return {
      kind: "semantic_unit",
      unit: unit === "paragraph" || unit === "line" ? unit : "sentence",
      query: selector.content.semantic,
    };
  }
  if (selector.content?.text !== undefined && selector.source === "PDF_BASE") {
    return { kind: "text_span", quote: selector.content.text };
  }
  const kind = selector.kinds?.[0];
  if (kind !== undefined) {
    return {
      kind: "object",
      objectType: kind,
      ...(selector.content?.text === undefined ? {} : { query: selector.content.text }),
      ...(selector.temporal === "RECENT" ? { relation: "recent" as const } : {}),
    };
  }
  if (selector.content?.text !== undefined) {
    return { kind: "text_span", quote: selector.content.text };
  }
  return undefined;
}

function targetResolutionInput(
  query: TargetQuery,
  context: FrozenWorldContext,
): TargetResolutionInput {
  return {
    query,
    catalog: context.catalog,
    frozenContext: context.frozenVoiceContext,
    recentOperations: context.recentOperations,
    ...(context.speechGroundingEvidence === undefined
      ? {}
      : { speechGroundingEvidence: context.speechGroundingEvidence }),
    ...(context.lastReusableTarget === undefined
      ? {}
      : { lastReusableTarget: context.lastReusableTarget }),
  };
}

function mapTargetResolution(result: TargetResolutionResult): WorldResolutionResult {
  if (result.status === "NOT_FOUND") {
    return result.reasonCode === "SUBRANGE_UNSUPPORTED"
      || result.reasonCode === "TARGET_KIND_UNSUPPORTED"
      ? { status: "UNSUPPORTED", reasonCode: result.reasonCode }
      : { status: "NOT_FOUND" };
  }
  if (result.status === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      candidates: result.candidates.slice(0, MAX_COMPACT_CANDIDATES).flatMap((ranked, index) => {
        const objectId = ranked.candidate.sceneObjectId;
        return objectId === undefined
          ? []
          : [{
              label: `C${index + 1}` as const,
              ref: { kind: "OBJECT" as const, objectId },
              kind: ranked.candidate.type,
              source: ranked.candidate.source,
              ...(ranked.candidate.text === undefined
                ? {}
                : { textPreview: ranked.candidate.text.slice(0, 160) }),
            }];
      }),
    };
  }
  if (result.target.kind === "object") {
    return {
      status: "RESOLVED",
      ref: { kind: "OBJECT", objectId: result.target.objectId },
    };
  }
  return {
    status: "RESOLVED",
    ref: {
      kind: "TEXT_RANGE",
      rangeId: result.target.candidateId,
      objectIds: result.target.objectId === undefined ? [] : [result.target.objectId],
      rects: result.target.bounds ?? [],
    },
  };
}

function ambiguousFromEntries(
  entries: readonly ObjectIndexEntry[],
  world: UnifiedObjectWorld,
): WorldResolutionResult {
  return {
    status: "AMBIGUOUS",
    candidates: entries.slice(0, MAX_COMPACT_CANDIDATES).map((entry, index) => ({
      label: `C${index + 1}` as const,
      ref: objectRef(entry),
      kind: entry.kind,
      source: entry.source,
      ...(world.getObjectMetadata(entry.objectId)?.searchableText === undefined
        ? {}
        : { textPreview: world.getObjectMetadata(entry.objectId)?.searchableText?.slice(0, 160) }),
    })),
  };
}

function objectRef(entry: ObjectIndexEntry): EntityRef {
  return { kind: "OBJECT", objectId: entry.objectId };
}

function refMatchesSelector(
  ref: EntityRef,
  selector: EntitySelector,
  world: UnifiedObjectWorld,
): boolean {
  if (ref.kind !== "OBJECT") return selector.kinds === undefined;
  const metadata = world.getObjectMetadata(ref.objectId);
  if (metadata === undefined) return false;
  return (selector.kinds === undefined || selector.kinds.includes(metadata.kind))
    && (selector.source !== "PDF_BASE" || metadata.source === "PDF_BASE")
    && (
      selector.source !== "USER_CREATED"
      || metadata.source === "USER_CANVAS"
      || metadata.source === "USER_ANNOTATION"
    );
}

function boundsForRef(
  ref: EntityRef,
  world: UnifiedObjectWorld,
): { readonly status: "RESOLVED"; readonly bounds: Rect } | { readonly status: "NOT_FOUND" } {
  if (ref.kind === "OBJECT") {
    const bounds = world.getObjectMetadata(ref.objectId)?.renderBounds;
    return bounds === undefined ? { status: "NOT_FOUND" } : { status: "RESOLVED", bounds };
  }
  if (ref.kind === "OBJECT_PART") {
    const bounds = ref.bounds ?? world.getObjectMetadata(ref.objectId)?.renderBounds;
    return bounds === undefined ? { status: "NOT_FOUND" } : { status: "RESOLVED", bounds };
  }
  if (ref.kind === "TEXT_RANGE") {
    const bounds = unionRects(ref.rects);
    return bounds === undefined ? { status: "NOT_FOUND" } : { status: "RESOLVED", bounds };
  }
  return { status: "NOT_FOUND" };
}

function matchesRelation(
  candidate: Rect,
  reference: Rect,
  relation: Exclude<NoteSpatialRelation, "BETWEEN">,
): boolean {
  const candidateRight = candidate.x + candidate.width;
  const candidateBottom = candidate.y + candidate.height;
  const referenceRight = reference.x + reference.width;
  const referenceBottom = reference.y + reference.height;
  const horizontalOverlap = candidate.x < referenceRight && candidateRight > reference.x;
  const verticalOverlap = candidate.y < referenceBottom && candidateBottom > reference.y;
  switch (relation) {
    case "ABOVE": return candidateBottom <= reference.y && horizontalOverlap;
    case "BELOW": return candidate.y >= referenceBottom && horizontalOverlap;
    case "LEFT_OF": return candidateRight <= reference.x && verticalOverlap;
    case "RIGHT_OF": return candidate.x >= referenceRight && verticalOverlap;
    case "BESIDE":
      return (candidateRight <= reference.x || candidate.x >= referenceRight) && verticalOverlap;
    case "NEAR": return rectDistance(candidate, reference) <= 96;
    case "INSIDE":
      return candidate.x >= reference.x && candidate.y >= reference.y
        && candidateRight <= referenceRight && candidateBottom <= referenceBottom;
    case "OVERLAPS": return horizontalOverlap && verticalOverlap;
    case "SAME_ROW": return verticalOverlap;
    case "SAME_COLUMN": return horizontalOverlap;
  }
}

function pageRegionBounds(page: Rect, region: NotePageRegion): Rect {
  const thirdWidth = page.width / 3;
  const thirdHeight = page.height / 3;
  switch (region) {
    case "TOP_LEFT": return { x: page.x, y: page.y, width: thirdWidth, height: thirdHeight };
    case "TOP": return { x: page.x + thirdWidth, y: page.y, width: thirdWidth, height: thirdHeight };
    case "TOP_RIGHT": return { x: page.x + 2 * thirdWidth, y: page.y, width: thirdWidth, height: thirdHeight };
    case "LEFT": return { x: page.x, y: page.y + thirdHeight, width: thirdWidth, height: thirdHeight };
    case "CENTER": return { x: page.x + thirdWidth, y: page.y + thirdHeight, width: thirdWidth, height: thirdHeight };
    case "RIGHT": return { x: page.x + 2 * thirdWidth, y: page.y + thirdHeight, width: thirdWidth, height: thirdHeight };
    case "BOTTOM_LEFT": return { x: page.x, y: page.y + 2 * thirdHeight, width: thirdWidth, height: thirdHeight };
    case "BOTTOM": return { x: page.x + thirdWidth, y: page.y + 2 * thirdHeight, width: thirdWidth, height: thirdHeight };
    case "BOTTOM_RIGHT": return { x: page.x + 2 * thirdWidth, y: page.y + 2 * thirdHeight, width: thirdWidth, height: thirdHeight };
    case "MARGIN": {
      return { ...page };
    }
  }
}

function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function rectDistance(left: Rect, right: Rect): number {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.hypot(dx, dy);
}

export function capabilitiesForRef(
  ref: EntityRef,
  world: UnifiedObjectWorld,
): SceneObjectMetadataView["capabilities"] | undefined {
  if (ref.kind === "OBJECT" || ref.kind === "OBJECT_PART") {
    return world.getObjectMetadata(ref.objectId)?.capabilities;
  }
  if (ref.kind === "TEXT_RANGE") {
    const metadata = ref.objectIds
      .map((objectId) => world.getObjectMetadata(objectId))
      .filter((entry): entry is SceneObjectMetadataView => entry !== undefined);
    if (metadata.length === 0) return undefined;
    return {
      anchorable: metadata.every((entry) => entry.capabilities.anchorable),
      annotatable: metadata.every((entry) => entry.capabilities.annotatable),
      editable: metadata.every((entry) => entry.capabilities.editable),
      movable: metadata.every((entry) => entry.capabilities.movable),
      resizable: metadata.every((entry) => entry.capabilities.resizable),
      deletable: metadata.every((entry) => entry.capabilities.deletable),
      textRangeAddressable: metadata.every((entry) => entry.capabilities.textRangeAddressable),
      partAddressable: metadata.every((entry) => entry.capabilities.partAddressable),
    };
  }
  return undefined;
}

import type { Rect, Size } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  MultimodalClearanceCategory,
  MultimodalPlacementRequest,
  MultimodalSoftOverlapCategory,
  PlacementCandidate,
  PlacementCandidateAlias,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialPlacementQuery,
  SpatialSceneSnapshot,
} from "../domain";
import { MULTIMODAL_PLACEMENT_LIMITS } from "../domain";
import { isFinitePositiveRect, rectBottom, rectRight } from "./spatial-occupancy-index";
import type {
  SpatialScreenshot,
  SpatialScreenshotSource,
} from "./spatial-screenshot-source";

export const MULTIMODAL_OBSERVATION_CONFIG = Object.freeze({
  globalMaxEdge: 1_280,
  localMaxEdge: 1_536,
  localContextPadding: 24,
  badgeWidth: 38,
  badgeHeight: 20,
  badgeGap: 4,
  markStrokeWidth: 3,
});

export interface SpatialEncodedImage {
  readonly dataUrl: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly byteLength: number;
}

export interface PlacementCandidateMark {
  readonly alias: PlacementCandidateAlias;
  readonly footprint: Rect;
  readonly badge: Rect;
}

export interface MultimodalPlacementRenderPlan {
  readonly globalOverview: {
    readonly sourcePixels: Rect;
    readonly outputSize: Size;
  };
  readonly localCandidateCrop: {
    readonly sourcePixels: Rect;
    readonly outputSize: Size;
    readonly marks: readonly PlacementCandidateMark[];
  };
}

export interface SpatialObservationImageProcessor {
  render(input: {
    readonly screenshot: SpatialScreenshot;
    readonly plan: MultimodalPlacementRenderPlan;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly globalOverview: SpatialEncodedImage;
    readonly localCandidateCrop: SpatialEncodedImage;
  }>;
}

export interface MultimodalPlacementObservation {
  readonly observationId: string;
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly request: MultimodalPlacementRequest;
  readonly aliasMap: ReadonlyMap<PlacementCandidateAlias, PlacementCandidate>;
  readonly renderPlan: MultimodalPlacementRenderPlan;
  readonly diagnostics: MultimodalPlacementObservationDiagnostics;
}

export interface MultimodalPlacementObservationDiagnostics {
  readonly observationId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly screenshotPixelWidth: number;
  readonly screenshotPixelHeight: number;
  readonly screenshotByteLength: number;
  readonly globalPixelWidth: number;
  readonly globalPixelHeight: number;
  readonly globalByteLength: number;
  readonly localPixelWidth: number;
  readonly localPixelHeight: number;
  readonly localByteLength: number;
  readonly candidateCount: number;
  readonly aliases: readonly PlacementCandidateAlias[];
  readonly screenshotLatencyMs: number;
  readonly observationBuildLatencyMs: number;
}

export type MultimodalPlacementObservationBuildResult =
  | {
      readonly status: "READY";
      readonly observation: MultimodalPlacementObservation;
    }
  | {
      readonly status: "STALE_SCENE" | "UNAVAILABLE" | "CANCELLED";
      readonly error?: unknown;
    };

export interface MultimodalPlacementObservationInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly draft: MeasuredDraft;
  readonly profile: PlacementProfile;
  readonly candidates: readonly PlacementCandidate[];
  readonly instruction: string;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly signal?: AbortSignal;
}

export interface MultimodalPlacementObservationBuilderOptions {
  readonly screenshotSource: SpatialScreenshotSource;
  readonly imageProcessor: SpatialObservationImageProcessor;
  readonly now?: () => number;
  readonly createObservationId?: (
    snapshot: SpatialSceneSnapshot,
    capturedAt: number,
  ) => string;
}

export class MultimodalPlacementObservationBuilder {
  private readonly now: () => number;
  private readonly createObservationId: NonNullable<
    MultimodalPlacementObservationBuilderOptions["createObservationId"]
  >;

  public constructor(
    private readonly options: MultimodalPlacementObservationBuilderOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.createObservationId = options.createObservationId
      ?? ((snapshot, capturedAt) =>
        `placement-observation:${encodeURIComponent(snapshot.pageId)}:${snapshot.sceneRevision}:${capturedAt}`);
  }

  public async build(
    input: MultimodalPlacementObservationInput,
  ): Promise<MultimodalPlacementObservationBuildResult> {
    if (input.signal?.aborted) return { status: "CANCELLED" };
    if (!isObservationInputConsistent(input)) return { status: "STALE_SCENE" };

    const buildStartedAt = this.now();
    const screenshotStartedAt = this.now();
    const captured = await this.options.screenshotSource.capture({
      snapshot: input.snapshot,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const screenshotFinishedAt = this.now();
    if (captured.status !== "READY") return captured;
    if (!isScreenshotConsistent(captured.screenshot, input.snapshot)) {
      return { status: "STALE_SCENE" };
    }
    if (input.signal?.aborted) return { status: "CANCELLED" };

    let plan: MultimodalPlacementRenderPlan;
    try {
      plan = buildMultimodalPlacementRenderPlan({
        screenshot: captured.screenshot,
        candidates: input.candidates,
        ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      });
    } catch (error) {
      return { status: "UNAVAILABLE", error };
    }

    let images: Awaited<ReturnType<SpatialObservationImageProcessor["render"]>>;
    try {
      images = await this.options.imageProcessor.render({
        screenshot: captured.screenshot,
        plan,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      return input.signal?.aborted
        ? { status: "CANCELLED", error }
        : { status: "UNAVAILABLE", error };
    }
    if (input.signal?.aborted) return { status: "CANCELLED" };

    const observationId = this.createObservationId(
      input.snapshot,
      captured.screenshot.capturedAt,
    );
    const aliases = input.candidates.map(
      (_, index): PlacementCandidateAlias => `S${index + 1}`,
    );
    const aliasMap = new Map<PlacementCandidateAlias, PlacementCandidate>(
      aliases.map((alias, index) => [alias, input.candidates[index]!] as const),
    );
    const request = buildProviderRequest(input, observationId, aliases, images);
    const finishedAt = this.now();

    return {
      status: "READY",
      observation: {
        observationId,
        pageId: input.snapshot.pageId,
        sceneRevision: input.snapshot.sceneRevision,
        request,
        aliasMap,
        renderPlan: plan,
        diagnostics: {
          observationId,
          pageId: input.snapshot.pageId,
          sceneRevision: input.snapshot.sceneRevision,
          screenshotPixelWidth: captured.screenshot.pixelWidth,
          screenshotPixelHeight: captured.screenshot.pixelHeight,
          screenshotByteLength: captured.screenshot.byteLength,
          globalPixelWidth: images.globalOverview.pixelWidth,
          globalPixelHeight: images.globalOverview.pixelHeight,
          globalByteLength: images.globalOverview.byteLength,
          localPixelWidth: images.localCandidateCrop.pixelWidth,
          localPixelHeight: images.localCandidateCrop.pixelHeight,
          localByteLength: images.localCandidateCrop.byteLength,
          candidateCount: aliases.length,
          aliases: Object.freeze(aliases),
          screenshotLatencyMs: elapsed(screenshotStartedAt, screenshotFinishedAt),
          observationBuildLatencyMs: elapsed(buildStartedAt, finishedAt),
        },
      },
    };
  }
}

export function buildMultimodalPlacementRenderPlan(input: {
  readonly screenshot: SpatialScreenshot;
  readonly candidates: readonly PlacementCandidate[];
  readonly anchor?: ResolvedSpatialAnchor;
}): MultimodalPlacementRenderPlan {
  const pageBounds = input.screenshot.canonicalPageBounds;
  if (!isFinitePositiveRect(pageBounds)
    || !Number.isInteger(input.screenshot.pixelWidth)
    || !Number.isInteger(input.screenshot.pixelHeight)
    || input.screenshot.pixelWidth <= 0
    || input.screenshot.pixelHeight <= 0
    || input.candidates.length < 2
    || input.candidates.length > MULTIMODAL_PLACEMENT_LIMITS.candidates
    || input.candidates.some((candidate) => !isFinitePositiveRect(candidate.bounds))) {
    throw new Error("A finite screenshot and 2 to 6 finite candidates are required.");
  }

  const fullSource = Object.freeze({
    x: 0,
    y: 0,
    width: input.screenshot.pixelWidth,
    height: input.screenshot.pixelHeight,
  });
  const canonicalCrop = paddedUnion(
    [
      ...(input.anchor === undefined ? [] : [input.anchor.bounds]),
      ...input.candidates.map((candidate) => candidate.bounds),
    ],
    MULTIMODAL_OBSERVATION_CONFIG.localContextPadding,
    pageBounds,
  );
  const sourceCrop = clampPixelRect(
    canonicalRectToScreenshotPixels(
      canonicalCrop,
      pageBounds,
      input.screenshot.pixelWidth,
      input.screenshot.pixelHeight,
    ),
    fullSource,
  );
  const localOutputSize = fitWithin(
    sourceCrop.width,
    sourceCrop.height,
    MULTIMODAL_OBSERVATION_CONFIG.localMaxEdge,
  );
  const localScaleX = localOutputSize.width / sourceCrop.width;
  const localScaleY = localOutputSize.height / sourceCrop.height;
  const occupiedBadges: Rect[] = [];
  const marks = input.candidates.map((candidate, index): PlacementCandidateMark => {
    const screenshotRect = canonicalRectToScreenshotPixels(
      candidate.bounds,
      pageBounds,
      input.screenshot.pixelWidth,
      input.screenshot.pixelHeight,
    );
    const footprint = Object.freeze({
      x: (screenshotRect.x - sourceCrop.x) * localScaleX,
      y: (screenshotRect.y - sourceCrop.y) * localScaleY,
      width: screenshotRect.width * localScaleX,
      height: screenshotRect.height * localScaleY,
    });
    const badge = placeAliasBadge(
      footprint,
      localOutputSize,
      occupiedBadges,
      index,
    );
    occupiedBadges.push(badge);
    return Object.freeze({
      alias: `S${index + 1}` as PlacementCandidateAlias,
      footprint,
      badge,
    });
  });

  return Object.freeze({
    globalOverview: Object.freeze({
      sourcePixels: fullSource,
      outputSize: fitWithin(
        fullSource.width,
        fullSource.height,
        MULTIMODAL_OBSERVATION_CONFIG.globalMaxEdge,
      ),
    }),
    localCandidateCrop: Object.freeze({
      sourcePixels: sourceCrop,
      outputSize: localOutputSize,
      marks: Object.freeze(marks),
    }),
  });
}

export function canonicalRectToScreenshotPixels(
  rect: Rect,
  canonicalPageBounds: Rect,
  pixelWidth: number,
  pixelHeight: number,
): Rect {
  if (!isFinitePositiveRect(canonicalPageBounds)
    || !isFinitePositiveRect(rect)
    || !Number.isFinite(pixelWidth)
    || !Number.isFinite(pixelHeight)
    || pixelWidth <= 0
    || pixelHeight <= 0) {
    throw new Error("Finite canonical and screenshot geometry is required.");
  }
  const scaleX = pixelWidth / canonicalPageBounds.width;
  const scaleY = pixelHeight / canonicalPageBounds.height;
  return {
    x: (rect.x - canonicalPageBounds.x) * scaleX,
    y: (rect.y - canonicalPageBounds.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function buildProviderRequest(
  input: MultimodalPlacementObservationInput,
  observationId: string,
  aliases: readonly PlacementCandidateAlias[],
  images: Awaited<ReturnType<SpatialObservationImageProcessor["render"]>>,
): MultimodalPlacementRequest {
  return Object.freeze({
    observationId,
    pageId: input.snapshot.pageId,
    sceneRevision: input.snapshot.sceneRevision,
    instruction: compactText(
      input.instruction,
      MULTIMODAL_PLACEMENT_LIMITS.instructionChars,
    ),
    draft: Object.freeze({
      kind: compactText(input.draft.kind, MULTIMODAL_PLACEMENT_LIMITS.kindChars),
      ...(input.draft.contentSummary === undefined
        ? {}
        : {
            contentSummary: compactText(
              input.draft.contentSummary,
              MULTIMODAL_PLACEMENT_LIMITS.summaryChars,
            ),
          }),
    }),
    ...(input.anchor === undefined
      ? {}
      : {
          anchor: Object.freeze({
            kind: input.anchor.kind,
            ...(input.anchor.semanticRole === undefined
              ? {}
              : { semanticRole: input.anchor.semanticRole }),
            ...(input.anchor.textPreview === undefined
              ? {}
              : {
                  textSummary: compactText(
                    input.anchor.textPreview,
                    MULTIMODAL_PLACEMENT_LIMITS.summaryChars,
                  ),
                }),
          }),
        }),
    candidates: Object.freeze(input.candidates.map((candidate, index) =>
      Object.freeze({
        alias: aliases[index]!,
        relation: candidate.relation,
        alignment: candidate.alignment,
        fit: candidate.sizeVariant,
        strategy: candidate.strategy,
        clearance: clearanceCategory(candidate.evidence.clearance, input.profile),
        softOverlap: softOverlapCategory(candidate),
        regionMatch: candidate.evidence.regionMatch,
      }))),
    images: Object.freeze({
      globalOverview: images.globalOverview.dataUrl,
      localCandidateCrop: images.localCandidateCrop.dataUrl,
    }),
  });
}

function isObservationInputConsistent(
  input: MultimodalPlacementObservationInput,
): boolean {
  return input.candidates.length >= 2
    && input.candidates.length <= MULTIMODAL_PLACEMENT_LIMITS.candidates
    && input.candidates.every((candidate) =>
      candidate.snapshotId === input.snapshot.snapshotId
      && candidate.sceneRevision === input.snapshot.sceneRevision
      && candidate.relation === input.query.relation);
}

function isScreenshotConsistent(
  screenshot: SpatialScreenshot,
  snapshot: SpatialSceneSnapshot,
): boolean {
  return screenshot.pageId === snapshot.pageId
    && screenshot.sceneRevision === snapshot.sceneRevision
    && isFinitePositiveRect(screenshot.canonicalPageBounds)
    && screenshot.canonicalPageBounds.x === snapshot.pageBounds.x
    && screenshot.canonicalPageBounds.y === snapshot.pageBounds.y
    && screenshot.canonicalPageBounds.width === snapshot.pageBounds.width
    && screenshot.canonicalPageBounds.height === snapshot.pageBounds.height;
}

function clearanceCategory(
  clearance: number,
  profile: PlacementProfile,
): MultimodalClearanceCategory {
  if (!Number.isFinite(clearance)) return "HIGH";
  if (clearance >= profile.minClearance * 2) return "HIGH";
  if (clearance >= profile.minClearance) return "MEDIUM";
  return "LOW";
}

function softOverlapCategory(
  candidate: PlacementCandidate,
): MultimodalSoftOverlapCategory {
  const overlap = candidate.evidence.softOverlapArea;
  if (overlap <= 0) return "NONE";
  const area = candidate.bounds.width * candidate.bounds.height;
  return overlap <= area * 0.1 ? "LOW" : "PRESENT";
}

function paddedUnion(rects: readonly Rect[], padding: number, bounds: Rect): Rect {
  const left = Math.min(...rects.map((rect) => rect.x)) - padding;
  const top = Math.min(...rects.map((rect) => rect.y)) - padding;
  const right = Math.max(...rects.map(rectRight)) + padding;
  const bottom = Math.max(...rects.map(rectBottom)) + padding;
  const x = Math.max(bounds.x, left);
  const y = Math.max(bounds.y, top);
  return {
    x,
    y,
    width: Math.max(1, Math.min(rectRight(bounds), right) - x),
    height: Math.max(1, Math.min(rectBottom(bounds), bottom) - y),
  };
}

function clampPixelRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.floor(rect.x));
  const y = Math.max(bounds.y, Math.floor(rect.y));
  const right = Math.min(rectRight(bounds), Math.ceil(rectRight(rect)));
  const bottom = Math.min(rectBottom(bounds), Math.ceil(rectBottom(rect)));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function fitWithin(width: number, height: number, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return Object.freeze({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
}

function placeAliasBadge(
  footprint: Rect,
  outputSize: Size,
  occupied: readonly Rect[],
  ordinal: number,
): Rect {
  const config = MULTIMODAL_OBSERVATION_CONFIG;
  const candidates = [
    { x: footprint.x, y: footprint.y - config.badgeHeight - config.badgeGap },
    { x: footprint.x, y: footprint.y + config.badgeGap },
    { x: rectRight(footprint) - config.badgeWidth, y: footprint.y + config.badgeGap },
    { x: footprint.x, y: rectBottom(footprint) - config.badgeHeight - config.badgeGap },
    {
      x: rectRight(footprint) - config.badgeWidth,
      y: rectBottom(footprint) - config.badgeHeight - config.badgeGap,
    },
  ].map((point) => clampBadge(point.x, point.y, outputSize));
  const available = candidates.find((candidate) =>
    occupied.every((other) => !overlaps(candidate, other)));
  if (available !== undefined) return Object.freeze(available);
  return Object.freeze(clampBadge(
    footprint.x + ordinal * config.badgeGap,
    footprint.y + ordinal * config.badgeHeight,
    outputSize,
  ));
}

function clampBadge(x: number, y: number, outputSize: Size): Rect {
  const width = Math.min(MULTIMODAL_OBSERVATION_CONFIG.badgeWidth, outputSize.width);
  const height = Math.min(MULTIMODAL_OBSERVATION_CONFIG.badgeHeight, outputSize.height);
  return {
    x: Math.max(0, Math.min(outputSize.width - width, x)),
    y: Math.max(0, Math.min(outputSize.height - height, y)),
    width,
    height,
  };
}

function overlaps(left: Rect, right: Rect): boolean {
  return left.x < rectRight(right)
    && rectRight(left) > right.x
    && left.y < rectBottom(right)
    && rectBottom(left) > right.y;
}

function compactText(value: string, maxChars: number): string {
  const compact = value.trim().replace(/\s+/gu, " ");
  return (compact.length === 0 ? "UNSPECIFIED" : compact).slice(0, maxChars);
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}

import type { Vector3 } from "@ggulnote/gaze-core";
import type {
  GazeTimelineCalibrationMetadata,
  PdfViewportHit,
  TimedGazeSample,
} from "@ggulnote/interaction-core";
import {
  applyResidualBiasCorrection,
  projectRawGazeToViewportWithoutBias,
} from "./affine-calibration";
import {
  calculateChiSquareQuantile2D,
  createConfidenceRoiAtPoint,
  toLegacyGazeRoi95,
  type ConfidenceRoiPlacementTemplate,
} from "./confidence-roi-estimator";
import {
  LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
  type GazeCalibrationProfile,
  type ViewportPoint,
  type ViewportRect,
} from "../domain/calibration-types";
import type { PursuitCalibrationProfile } from "../application/pursuit-calibration-controller";

type FixedGridTimelineProfile = Pick<
  GazeCalibrationProfile,
  | "id"
  | "version"
  | "model"
  | "quality"
  | "residualDistribution"
  | "roiTemplate95"
> & Readonly<{ readonly mode?: "fixed-grid" }>;

type SmoothPursuitTimelineProfile = Pick<
  PursuitCalibrationProfile,
  | "id"
  | "version"
  | "mode"
  | "model"
  | "quality"
  | "residualDistribution"
  | "roiTemplate"
>;

export type GazeTimelineCalibrationProfile =
  | FixedGridTimelineProfile
  | SmoothPursuitTimelineProfile;

export type GazeTimelineCalibrationContext = Readonly<{
  readonly profile: GazeTimelineCalibrationProfile | null;
  readonly pdfViewportRect: ViewportRect | null;
}>;

export type ActiveCalibrationContextProvider = Readonly<{
  getCalibrationContext(): GazeTimelineCalibrationContext;
}>;

export type GazeTimelineTransformFailureReason =
  | "raw-vector-unavailable"
  | "projection-failed"
  | "invalid-profile"
  | "invalid-roi";

export type GazeTimelineSampleTransformResult =
  | Readonly<{
      readonly ok: true;
      readonly kind: "raw-only" | "calibrated";
      readonly sample: TimedGazeSample;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: GazeTimelineTransformFailureReason;
      readonly sample: TimedGazeSample;
    }>;

/**
 * Calibration and live inference both use rawCombinedDirection. No fallback to
 * the smoothed vector is allowed because it would change the model feature.
 */
export function transformGazeTimelineSample(
  sample: TimedGazeSample,
  context: GazeTimelineCalibrationContext,
): GazeTimelineSampleTransformResult {
  const profile = context.profile;
  if (profile === null) {
    return { ok: true, kind: "raw-only", sample };
  }
  if (!isValidProfileBase(profile)) {
    return { ok: false, reason: "invalid-profile", sample };
  }

  const rawVector: unknown = sample.observation.rawCombinedDirection;
  if (!isFiniteVector(rawVector)) {
    return { ok: false, reason: "raw-vector-unavailable", sample };
  }

  const templateResult = getPlacementTemplate(profile);
  if (!templateResult.ok) {
    return { ok: false, reason: templateResult.reason, sample };
  }

  const predicted = projectRawGazeToViewportWithoutBias(profile.model, rawVector);
  const corrected = applyResidualBiasCorrection(
    predicted,
    profile.residualDistribution.bias,
  );
  if (!isFinitePoint(corrected)) {
    return { ok: false, reason: "projection-failed", sample };
  }

  let confidenceRoi;
  try {
    confidenceRoi = createConfidenceRoiAtPoint(
      corrected,
      templateResult.template,
      context.pdfViewportRect ?? undefined,
      profile.version,
    );
  } catch {
    return { ok: false, reason: "invalid-roi", sample };
  }
  if (!isValidConfidenceRoi(confidenceRoi)) {
    return { ok: false, reason: "invalid-roi", sample };
  }

  const pdfHit = context.pdfViewportRect === null
    ? null
    : toPdfViewportHit(corrected, context.pdfViewportRect);
  const mode = profile.mode === "smooth-pursuit"
    ? "smooth-pursuit"
    : "fixed-grid";
  const calibration: GazeTimelineCalibrationMetadata = {
    profileId: profile.id,
    version: profile.version,
    mode,
    quality: profile.quality,
    coverageProbability: confidenceRoi.coverageProbability,
    roiEstimationMethod: confidenceRoi.estimationMethod,
    roiSource: confidenceRoi.source,
  };
  const legacyRoi = toLegacyGazeRoi95(confidenceRoi);
  const transformed: TimedGazeSample = {
    ...sample,
    calibratedViewportPoint: { ...corrected },
    confidenceRoi,
    gazeRoi95: legacyRoi.ok ? legacyRoi.value : null,
    pdfHit,
    calibration: {
      profileId: profile.id,
      version: profile.version,
      quality: profile.quality,
    },
    calibrationData: {
      viewportPoint: { ...corrected },
      confidenceRoi,
      pdfHit,
      calibration,
    },
  };

  return { ok: true, kind: "calibrated", sample: transformed };
}

export function createGazeTimelineSampleTransformer(
  provider: ActiveCalibrationContextProvider,
): (sample: TimedGazeSample) => Partial<TimedGazeSample> {
  return (sample) => {
    const result = transformGazeTimelineSample(
      sample,
      provider.getCalibrationContext(),
    );
    return result.ok ? result.sample : {};
  };
}

/**
 * Rect boundaries are inclusive. Outside points retain their real local and
 * normalized CSS-pixel coordinates, which can be outside the 0..1 range.
 */
export function toPdfViewportHit(
  viewportPoint: ViewportPoint,
  pdfViewportRect: ViewportRect,
): PdfViewportHit | null {
  if (!isFinitePoint(viewportPoint) || !isValidViewportRect(pdfViewportRect)) {
    return null;
  }
  const localX = viewportPoint.x - pdfViewportRect.left;
  const localY = viewportPoint.y - pdfViewportRect.top;
  return {
    isInsidePdfViewport:
      localX >= 0
      && localY >= 0
      && localX <= pdfViewportRect.width
      && localY <= pdfViewportRect.height,
    localPoint: { x: localX, y: localY },
    normalizedPoint: {
      x: localX / pdfViewportRect.width,
      y: localY / pdfViewportRect.height,
    },
  };
}

type PlacementTemplateResult =
  | Readonly<{ readonly ok: true; readonly template: ConfidenceRoiPlacementTemplate }>
  | Readonly<{ readonly ok: false; readonly reason: "invalid-profile" | "invalid-roi" }>;

function getPlacementTemplate(
  profile: GazeTimelineCalibrationProfile,
): PlacementTemplateResult {
  if (profile.mode === "smooth-pursuit") {
    return isValidPlacementTemplate(profile.roiTemplate)
      ? { ok: true, template: profile.roiTemplate }
      : { ok: false, reason: "invalid-roi" };
  }

  const quantile = calculateChiSquareQuantile2D(
    LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
  );
  if (!quantile.ok) {
    return { ok: false, reason: "invalid-profile" };
  }
  const template: ConfidenceRoiPlacementTemplate = {
    coverageProbability: LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
    radiusMajor: profile.roiTemplate95.radiusMajor,
    radiusMinor: profile.roiTemplate95.radiusMinor,
    rotationRad: profile.roiTemplate95.rotationRad,
    covariance: profile.roiTemplate95.covariance,
    scaleQuantile: quantile.value.quantile,
    estimationMethod: "gaussian-chi-square",
    source: profile.roiTemplate95.source,
    // Legacy fixed-grid profiles did not persist a bounds-clamp policy.
    clampBoundsToViewport: false,
  };
  return isValidPlacementTemplate(template)
    ? { ok: true, template }
    : { ok: false, reason: "invalid-roi" };
}

function isValidProfileBase(profile: GazeTimelineCalibrationProfile): boolean {
  return profile.id.trim().length > 0
    && profile.version.trim().length > 0
    && (profile.quality === "valid" || profile.quality === "degraded")
    && profile.model.method === "affine-2d"
    && isFinitePoint(profile.residualDistribution.bias);
}

function isValidPlacementTemplate(
  template: ConfidenceRoiPlacementTemplate,
): boolean {
  return Number.isFinite(template.coverageProbability)
    && template.coverageProbability > 0
    && template.coverageProbability < 1
    && Number.isFinite(template.radiusMajor)
    && template.radiusMajor > 0
    && Number.isFinite(template.radiusMinor)
    && template.radiusMinor > 0
    && Number.isFinite(template.rotationRad)
    && Number.isFinite(template.scaleQuantile)
    && template.scaleQuantile > 0
    && Number.isFinite(template.covariance.xx)
    && Number.isFinite(template.covariance.xy)
    && Number.isFinite(template.covariance.yy)
    && (template.estimationMethod === "empirical-mahalanobis"
      || template.estimationMethod === "gaussian-chi-square")
    && (template.source === "validation-residuals" || template.source === "fallback");
}

function isValidConfidenceRoi(
  roi: ReturnType<typeof createConfidenceRoiAtPoint>,
): boolean {
  return isFinitePoint(roi.center)
    && Number.isFinite(roi.radiusMajor)
    && roi.radiusMajor > 0
    && Number.isFinite(roi.radiusMinor)
    && roi.radiusMinor > 0
    && Number.isFinite(roi.axisAlignedBounds.left)
    && Number.isFinite(roi.axisAlignedBounds.top)
    && Number.isFinite(roi.axisAlignedBounds.right)
    && Number.isFinite(roi.axisAlignedBounds.bottom);
}

function isFiniteVector(value: unknown): value is Vector3 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "x" in value
    && "y" in value
    && "z" in value
    && typeof value.x === "number"
    && typeof value.y === "number"
    && typeof value.z === "number"
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

function isFinitePoint(point: ViewportPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isValidViewportRect(rect: ViewportRect): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

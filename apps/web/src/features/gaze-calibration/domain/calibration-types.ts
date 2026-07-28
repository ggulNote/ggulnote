import type { Vector3 } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "@ggulnote/shared-types";

export const DEFAULT_CALIBRATION_CONFIG = {
  gridRows: 3,
  gridColumns: 3,
  edgeInsetRatio: 0.07,
} as const;

export const DEFAULT_COLLECTION_CONFIG = {
  minimumSamplesPerTarget: 20,
  trimRatio: 0.2,
} as const;

export const DEFAULT_TIMING_CONFIG = {
  prepareDurationMs: 1000,
  settleDurationMs: 600,
  collectDurationMs: 1200,
  transitionDurationMs: 300,
} as const;

export const DEFAULT_QUALITY_THRESHOLDS = {
  maximumRmsePx: 80,
  maximumRadialErrorPx: 100,
  minimumValidationSamples: 4,
} as const;

export const CHI_SQUARE_2D_95 = 5.991;
export const CALIBRATION_MODEL_VERSION = "1.0.0";
export const MIN_RESIDUAL_SAMPLES_FOR_ROI = 3;
export const MAX_ROI_RADIUS_RATIO = 0.6;
export const SMALL_EIGENVALUE_EPSILON = 1e-10;
export const MIN_RADIUS_PX = 1;

export type ViewportRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type ViewportPoint = {
  readonly x: number;
  readonly y: number;
};

export type AxisAlignedBounds = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

export type PdfViewportRect = ViewportRect;

export type PdfViewportHit = {
  readonly isInsidePdfViewport: boolean;
  readonly localPoint: ViewportPoint;
  readonly normalizedPoint: ViewportPoint;
};

export type CalibrationTargetRole = "calibration" | "validation";

export type CalibrationTarget = Readonly<{
  readonly id: string;
  readonly order: number;
  readonly role: CalibrationTargetRole;
  readonly normalizedPoint: ViewportPoint;
  readonly viewportPoint: ViewportPoint;
}>;

export type CalibrationTargetGeneratorInput = Readonly<{
  readonly viewportRect: PdfViewportRect;
  readonly rows: number;
  readonly columns: number;
  readonly edgeInsetRatio: number;
}>;

export type CalibrationTargetSet = Readonly<{
  readonly calibrationTargets: readonly CalibrationTarget[];
  readonly validationTargets: readonly CalibrationTarget[];
}>;

export type CalibrationVector3D = Vector3;
export type RawGazeVector = CalibrationVector3D;

export type CalibrationRawSample = Readonly<{
  readonly targetId: string;
  readonly sessionId: number;
  readonly timestampMs: number;
  readonly rawVector: CalibrationVector3D;
  readonly smoothedVector?: CalibrationVector3D;
  readonly sequenceId?: number;
  readonly trackingQuality?: number | null;
}>;

export type CalibrationObservation = Readonly<{
  readonly target: CalibrationTarget;
  readonly sample: CalibrationRawSample;
}>;

export type RepresentativeRawVector = Readonly<{
  readonly target: CalibrationTarget;
  readonly rawVector: CalibrationVector3D;
  readonly representativeTimestampMs: number;
}>;

export type CalibrationErrorKind =
  | "sample-count"
  | "target-distribution"
  | "singular-matrix"
  | "invalid-number"
  | "validation-failed"
  | "validation-timeout"
  | "validation-distribution"
  | "roi-not-possible";

export type CalibrationError = Readonly<{
  readonly kind: CalibrationErrorKind;
  readonly message: string;
}>;

export type ResultOk<T> = Readonly<{
  readonly ok: true;
  readonly value: T;
}>;

export type ResultError<TKind extends string = string> = Readonly<{
  readonly ok: false;
  readonly error: Readonly<{
    readonly kind: TKind;
    readonly message: string;
  }>;
}>;

export type Result<T, TKind extends string = string> = ResultOk<T> | ResultError<TKind>;

export type CalibrationTargetGenerationError = "input-invalid" | "sample-count";

export type AffineCalibrationModel = Readonly<{
  readonly method: "affine-2d";
  readonly coefficientsX: readonly [number, number, number];
  readonly coefficientsY: readonly [number, number, number];
  readonly viewportBasis: Readonly<{
    readonly width: number;
    readonly height: number;
  }>;
  readonly biasCorrection: Readonly<{ readonly x: number; readonly y: number }>;
  readonly version: string;
  readonly createdAtMs: number;
}>;

export type ResidualBias = Readonly<{ readonly x: number; readonly y: number }>;

export type ResidualCovariance = Readonly<{
  readonly xx: number;
  readonly xy: number;
  readonly yy: number;
}>;

export type CalibrationValidationMetrics = Readonly<{
  readonly sampleCount: number;
  readonly meanResidual: Readonly<{ readonly x: number; readonly y: number }>;
  readonly rmse: Readonly<{ readonly x: number; readonly y: number; readonly radial: number }>;
  readonly meanAbsoluteError: Readonly<{ readonly x: number; readonly y: number }>;
  readonly maxRadialError: number;
}>;

export type ValidationResidualSample = Readonly<{
  readonly target: ViewportPoint;
  readonly predicted: ViewportPoint;
  readonly residual: ViewportPoint;
}>;

export type ResidualAnalysisResult = Readonly<{
  readonly rawResiduals: readonly ValidationResidualSample[];
  readonly biasCorrection: ResidualBias;
  readonly correctedResiduals: readonly ValidationResidualSample[];
  readonly metricsBeforeCorrection: CalibrationValidationMetrics;
  readonly metricsAfterCorrection: CalibrationValidationMetrics;
}>;

export type ResidualError = "sample-count" | "invalid-number";

export type RoiEstimationError = "sample-count" | "invalid-number" | "invalid-covariance";

export type CalibrationRoiTemplate = Readonly<{
  readonly radiusMajor: number;
  readonly radiusMinor: number;
  readonly rotationRad: number;
  readonly covariance: ResidualCovariance;
  readonly source: "validation-residuals" | "fallback";
}>;

export type GazeRoi95 = Readonly<{
  readonly confidence: 0.95;
  readonly shape: "ellipse";
  readonly center: ViewportPoint;
  readonly radiusMajor: number;
  readonly radiusMinor: number;
  readonly rotationRad: number;
  readonly axisAlignedBounds: Readonly<AxisAlignedBounds>;
  readonly covariance: ResidualCovariance;
  readonly source: "validation-residuals" | "fallback";
  readonly calibrationVersion: string;
}>;

export type GazeCalibrationProfile = Readonly<{
  readonly id: string;
  readonly version: string;
  readonly createdAtMs: number;
  readonly pdfViewportBasis: Readonly<{ readonly width: number; readonly height: number }>;
  readonly model: AffineCalibrationModel;
  readonly validation: CalibrationValidationMetrics;
  readonly quality: "valid" | "degraded";
  readonly residualDistribution: Readonly<{
    readonly bias: ResidualBias;
    readonly covariance: ResidualCovariance;
  }>;
  readonly roiTemplate95: Readonly<{
    readonly radiusMajor: number;
    readonly radiusMinor: number;
    readonly rotationRad: number;
    readonly covariance: ResidualCovariance;
    readonly source: "validation-residuals" | "fallback";
  }>;
}>;

export type RoiEstimationResult = Readonly<{
  readonly template: CalibrationRoiTemplate;
  readonly fallbackApplied: boolean;
}>;

export type CalibrationPhase =
  | "idle"
  | "preparing"
  | "settling"
  | "collecting"
  | "transitioning"
  | "fitting"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";

export type CalibrationSessionControllerState = Readonly<{
  readonly phase: CalibrationPhase;
  readonly sessionId: number | null;
  readonly isRunning: boolean;
  readonly statusMessage: string | null;
  readonly error: CalibrationError | null;
  readonly activeTarget: CalibrationTarget | null;
  readonly currentTargetRole: CalibrationTargetRole | null;
  readonly currentTargetSampleCount: number;
  readonly calibrationTargetCount: number;
  readonly validationTargetCount: number;
  readonly progress: number;
  readonly sessionStartedAtMs: SessionTimeMs | null;
  readonly phaseStartedAtMs: SessionTimeMs | null;
  readonly currentTargetIndex: number;
  readonly totalTargetCount: number;
  readonly collectedTargetSampleCount: ReadonlyMap<string, number>;
  readonly excludedSampleCountByReason: ReadonlyMap<SampleAcceptanceReason, number>;
  readonly collectingWindowStartMs: SessionTimeMs | null;
  readonly collectingWindowEndMs: SessionTimeMs | null;
  readonly activeProfile: GazeCalibrationProfile | null;
  readonly activeProfileQuality: "valid" | "degraded" | null;
  readonly roiTemplate: CalibrationRoiTemplate | null;
  readonly validationMetrics: CalibrationValidationMetrics | null;
  readonly validationMetricsBeforeCorrection: CalibrationValidationMetrics | null;
  readonly validationRoiCandidateSource: "validation-residuals" | "fallback" | null;
}>;

export type CalibrationTimingConfig = Readonly<{
  readonly prepareDurationMs: number;
  readonly settleDurationMs: number;
  readonly collectDurationMs: number;
  readonly transitionDurationMs: number;
}>;

export type CalibrationCollectionConfig = Readonly<{
  readonly minimumSamplesPerTarget: number;
  readonly trimRatio: number;
}>;

export type CalibrationQualityThresholds = Readonly<{
  readonly maximumRmsePx: number;
  readonly maximumRadialErrorPx: number;
  readonly minimumValidationSamples: number;
}>;

export type SampleAcceptanceReason =
  | "session-mismatch"
  | "duplicate-sequence"
  | "out-of-window"
  | "late-response"
  | "invalid-number"
  | "invalid-quality"
  | "tracker-failure"
  | "not-collecting";

export type SampleCollectorInput = Readonly<{
  readonly rawSample: CalibrationRawSample;
  readonly activeTarget: CalibrationTarget | null;
  readonly sessionId: number;
  readonly windowStartMs: SessionTimeMs | null;
  readonly windowEndMs: SessionTimeMs | null;
}>;

export type SampleAcceptanceResult =
  | Readonly<{ readonly ok: true; readonly sample: CalibrationRawSample }>
  | Readonly<{ readonly ok: false; readonly reason: SampleAcceptanceReason }>;

export type TimelineSampleCalibrationMetadata = Readonly<{
  readonly profileId: string;
  readonly version: string;
  readonly quality: "valid" | "degraded";
}>;

export type TimelineSampleEnrichment = Readonly<{
  readonly calibratedViewportPoint: ViewportPoint | null;
  readonly gazeRoi95: GazeRoi95 | null;
  readonly pdfHit: PdfViewportHit | null;
  readonly calibration: TimelineSampleCalibrationMetadata | null;
}>;

export const makeResult = <T>(value: T): ResultOk<T> => ({ ok: true, value });

export const makeError = <TKind extends string>(kind: TKind, message: string): ResultError<TKind> => ({
  ok: false,
  error: { kind, message },
});

export const toPdfViewportLocalPoint = (
  viewportPoint: ViewportPoint,
  pdfRect: PdfViewportRect,
): PdfViewportHit | null => {
  if (!Number.isFinite(viewportPoint.x) || !Number.isFinite(viewportPoint.y)) {
    return null;
  }

  if (!Number.isFinite(pdfRect.left) || !Number.isFinite(pdfRect.top) || !Number.isFinite(pdfRect.width)
    || !Number.isFinite(pdfRect.height)) {
    return null;
  }

  if (pdfRect.width <= 0 || pdfRect.height <= 0) {
    return null;
  }

  const localX = viewportPoint.x - pdfRect.left;
  const localY = viewportPoint.y - pdfRect.top;

  return {
    isInsidePdfViewport: localX >= 0 && localY >= 0 && localX <= pdfRect.width && localY <= pdfRect.height,
    localPoint: { x: localX, y: localY },
    normalizedPoint: {
      x: localX / pdfRect.width,
      y: localY / pdfRect.height,
    },
  };
};



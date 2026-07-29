import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "../time/session-time";

export type CalibrationQuality = "valid" | "degraded";
export type GazeCalibrationMode = "fixed-grid" | "smooth-pursuit";
export type GazeRoiEstimationMethod =
  | "empirical-mahalanobis"
  | "gaussian-chi-square";
export type GazeRoiSource = "validation-residuals" | "fallback";
export type GazeRoiFallbackReason =
  | "insufficient-residuals"
  | "singular-covariance"
  | "invalid-distance-distribution"
  | "invalid-eigenvalues";

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

export type ResidualCovariance = {
  readonly xx: number;
  readonly xy: number;
  readonly yy: number;
};

export type GazeRoi95 = {
  readonly confidence: 0.95;
  readonly shape: "ellipse";

  readonly center: ViewportPoint;

  readonly radiusMajor: number;
  readonly radiusMinor: number;
  readonly rotationRad: number;

  readonly axisAlignedBounds: AxisAlignedBounds;

  readonly covariance: ResidualCovariance;
  readonly source: "validation-residuals" | "fallback";
  readonly calibrationVersion: string;
};

export type GazeConfidenceRoi = {
  readonly coverageProbability: number;
  readonly shape: "ellipse";
  readonly center: ViewportPoint;
  readonly radiusMajor: number;
  readonly radiusMinor: number;
  readonly rotationRad: number;
  readonly axisAlignedBounds: AxisAlignedBounds;
  readonly covariance: ResidualCovariance;
  readonly scaleQuantile: number;
  readonly estimationMethod: GazeRoiEstimationMethod;
  readonly source: GazeRoiSource;
  readonly fallbackReason?: GazeRoiFallbackReason;
  readonly calibrationVersion: string;
};

export type PdfViewportRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type PdfViewportHit = {
  readonly isInsidePdfViewport: boolean;
  readonly localPoint: ViewportPoint;
  readonly normalizedPoint: ViewportPoint;
};

export type GazeCalibrationMetadata = {
  readonly profileId: string;
  readonly version: string;
  readonly quality: CalibrationQuality;
};

export type GazeTimelineCalibrationMetadata = {
  readonly profileId: string;
  readonly version: string;
  readonly mode: GazeCalibrationMode;
  readonly quality: CalibrationQuality;
  readonly coverageProbability: number;
  readonly roiEstimationMethod: GazeRoiEstimationMethod;
  readonly roiSource: GazeRoiSource;
};

export type CalibratedGazeTimelineData = {
  readonly viewportPoint: ViewportPoint;
  readonly confidenceRoi: GazeConfidenceRoi;
  readonly pdfHit: PdfViewportHit | null;
  readonly calibration: GazeTimelineCalibrationMetadata;
};

export interface TimedGazeSample {
  readonly time: SessionTimeMs;
  readonly observation: RawGazeObservation;

  readonly calibratedViewportPoint: ViewportPoint | null;
  readonly gazeRoi95: GazeRoi95 | null;
  readonly pdfHit: PdfViewportHit | null;
  readonly calibration: GazeCalibrationMetadata | null;

  /**
   * Generic calibration data. Optional for source compatibility with stored
   * raw/legacy samples created before configurable-coverage ROI support.
   */
  readonly confidenceRoi?: GazeConfidenceRoi | null;
  readonly calibrationData?: CalibratedGazeTimelineData | null;
}

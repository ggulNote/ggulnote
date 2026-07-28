import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "../time/session-time";

export type CalibrationQuality = "valid" | "degraded";

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

export interface TimedGazeSample {
  readonly time: SessionTimeMs;
  readonly observation: RawGazeObservation;

  readonly calibratedViewportPoint: ViewportPoint | null;
  readonly gazeRoi95: GazeRoi95 | null;
  readonly pdfHit: PdfViewportHit | null;
  readonly calibration: GazeCalibrationMetadata | null;
}


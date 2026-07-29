"use client";

import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type {
  InteractionClock,
  TimedGazeSample,
} from "@ggulnote/interaction-core";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  PursuitCalibrationErrorCode,
  PursuitCalibrationProfile,
} from "../application/pursuit-calibration-controller";
import {
  DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  type PursuitCalibrationConfig,
} from "../config/pursuit-calibration-config";
import type { ViewportRect } from "../domain/calibration-types";
import {
  CALIBRATION_PURSUIT_TRAJECTORY,
  VALIDATION_PURSUIT_TRAJECTORY,
} from "../domain/pursuit-trajectories";
import type { PursuitSampleAcceptanceResult } from "../domain/pursuit-types";
import {
  usePursuitCalibration,
  type PursuitCalibrationControllerFactory,
} from "../hooks/use-pursuit-calibration";
import type {
  GazeCalibrationRuntimeContext,
} from "../runtime/gaze-calibration-runtime-context";
import { CalibratedGazeOverlay } from "./calibrated-gaze-overlay";
import { PursuitTargetOverlay } from "./pursuit-target-overlay";

export type PursuitObservationSink = (
  observation: RawGazeObservation,
) => PursuitSampleAcceptanceResult;

export type PursuitCalibrationDebugPanelProps = Readonly<{
  readonly clock: InteractionClock;
  readonly viewportRect: ViewportRect;
  readonly runtimeContext: GazeCalibrationRuntimeContext;
  readonly latestTimelineSample: TimedGazeSample | null;
  readonly onObservationSinkChange: (
    sink: PursuitObservationSink | null,
  ) => void;
  readonly onRequestFixedGridFallback?: () => void;
  readonly config?: PursuitCalibrationConfig;
  readonly controllerFactory?: PursuitCalibrationControllerFactory;
}>;

export function PursuitCalibrationDebugPanel({
  clock,
  viewportRect,
  runtimeContext,
  latestTimelineSample,
  onObservationSinkChange,
  onRequestFixedGridFallback,
  config = DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  controllerFactory,
}: PursuitCalibrationDebugPanelProps): React.ReactElement {
  const [dependencies] = useState(() => {
    let sessionSequence = 0;
    let profileSequence = 0;
    let versionSequence = 0;
    return {
      clock,
      config,
      viewportRect,
      calibrationTrajectory: CALIBRATION_PURSUIT_TRAJECTORY,
      validationTrajectory: VALIDATION_PURSUIT_TRAJECTORY,
      createSessionId: () => `pursuit-session-${++sessionSequence}`,
      createProfileId: () => `pursuit-profile-${++profileSequence}`,
      createVersion: () => `pursuit-v${++versionSequence}`,
    };
  });
  const [startError, setStartError] = useState<string | null>(null);
  const runtimeSnapshot = useSyncExternalStore(
    runtimeContext.subscribe,
    runtimeContext.getSnapshot,
    runtimeContext.getSnapshot,
  );
  const handleCompleted = useCallback((profile: PursuitCalibrationProfile): void => {
    runtimeContext.setProfile(profile);
    setStartError(null);
  }, [runtimeContext]);
  const calibration = usePursuitCalibration({
    dependencies,
    onCompleted: handleCompleted,
    controllerFactory,
  });

  useEffect(() => {
    onObservationSinkChange(calibration.pushRawGazeObservation);
    return () => {
      onObservationSinkChange(null);
    };
  }, [calibration.pushRawGazeObservation, onObservationSinkChange]);

  const { updateViewportRect } = calibration;
  useEffect(() => {
    updateViewportRect(viewportRect);
  }, [updateViewportRect, viewportRect]);

  const { snapshot } = calibration;
  const target = snapshot.currentTarget;
  const completedProfile = snapshot.profile;
  const activeProfile = runtimeSnapshot.profile;
  const latestCalibration = latestTimelineSample?.calibrationData;
  const error = snapshot.error;

  const startCalibration = (): void => {
    const result = calibration.start();
    setStartError(result.ok ? null : result.error.message);
  };

  return (
    <>
      <CalibratedGazeOverlay sample={latestTimelineSample} />
      {calibration.isActive ? (
        <PursuitTargetOverlay config={config} snapshot={snapshot} />
      ) : null}

      <section
        aria-label="Smooth Pursuit Calibration Debug"
        className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/60 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Smooth Pursuit Calibration
            </h2>
            <p aria-live="polite" className="text-sm text-slate-600">
              Phase: <strong>{snapshot.phase}</strong>
              {" / "}
              Role: <strong>{snapshot.role ?? "-"}</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={calibration.isActive}
              onClick={startCalibration}
              className="rounded-md bg-cyan-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Smooth Pursuit Calibration 시작
            </button>
            <button
              type="button"
              disabled={!calibration.isActive}
              onClick={calibration.cancel}
              className="rounded-md border border-red-600 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Calibration 취소
            </button>
            <button
              type="button"
              disabled={activeProfile === null}
              onClick={() => runtimeContext.setProfile(null)}
              className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              활성 Profile 제거
            </button>
            <button
              type="button"
              onClick={onRequestFixedGridFallback}
              className="rounded-md border border-amber-600 bg-white px-3 py-2 text-sm font-semibold text-amber-800"
            >
              Fixed-grid Fallback
            </button>
          </div>
        </div>

        {error !== null ? (
          <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <strong>{error.code}</strong>: {getCalibrationErrorMessage(error.code)}
            <div className="mt-1 text-xs">{error.message}</div>
          </div>
        ) : startError !== null ? (
          <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {startError}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <DebugGroup title="Session">
            <Metric label="Session ID" value={snapshot.sessionId ?? "-"} />
            <Metric label="Mode" value="smooth-pursuit" />
            <Metric label="Phase" value={snapshot.phase} />
            <Metric label="Active" value={String(calibration.isActive)} />
            <Metric
              label="Progress"
              value={`${snapshot.progress.completedSegments}/${snapshot.progress.totalSegments} (${formatPercent(snapshot.progress.overallRatio)})`}
            />
          </DebugGroup>

          <DebugGroup title="Trajectory">
            <Metric label="Segment ID" value={target?.segmentId ?? "-"} />
            <Metric
              label="Segment"
              value={target === null ? "-" : `${target.segmentIndex + 1}/${target.segmentCount}`}
            />
            <Metric
              label="Movement"
              value={target === null ? "-" : formatPercent(target.movementProgress)}
            />
            <Metric label="Collecting" value={String(target?.shouldCollectSample ?? false)} />
          </DebugGroup>

          <DebugGroup title="Sample Collection">
            <Metric label="Calibration Accepted" value={snapshot.collection.calibrationAcceptedCount} />
            <Metric label="Validation Accepted" value={snapshot.collection.validationAcceptedCount} />
            <Metric label="Rejected" value={snapshot.collection.rejectedCount} />
            <Metric label="Rejection Reasons" value={formatRejectionCounts(snapshot.collection.rejectionCounts)} />
            <Metric label="Target Hit Rate" value="not recorded" />
          </DebugGroup>

          <DebugGroup title="Lag and Model">
            <Metric label="Lag Mode" value={config.lagAlignment.mode} />
            <Metric label="Lag ms" value={formatNumber(snapshot.lagEstimate?.lagMs)} />
            <Metric label="Correlation X" value={formatNumber(snapshot.lagEstimate?.correlationX)} />
            <Metric label="Correlation Y" value={formatNumber(snapshot.lagEstimate?.correlationY)} />
            <Metric label="Combined Score" value={formatNumber(snapshot.lagEstimate?.combinedScore)} />
            <Metric label="Lag Source" value={snapshot.lagEstimate?.source ?? "-"} />
            <Metric label="Affine Model" value={snapshot.affineModelAvailable ? "available" : "unavailable"} />
          </DebugGroup>

          <DebugGroup title="Validation">
            <Metric label="RMSE X" value={formatNumber(completedProfile?.validation.rmse.x)} />
            <Metric label="RMSE Y" value={formatNumber(completedProfile?.validation.rmse.y)} />
            <Metric label="RMSE Radial" value={formatNumber(completedProfile?.validation.rmse.radial)} />
            <Metric label="Mean Bias X" value={formatNumber(completedProfile?.residualDistribution.bias.x)} />
            <Metric label="Mean Bias Y" value={formatNumber(completedProfile?.residualDistribution.bias.y)} />
            <Metric label="Max Radial Error" value={formatNumber(completedProfile?.validation.maxRadialError)} />
          </DebugGroup>

          <DebugGroup title="Confidence ROI">
            <Metric label="Requested Coverage" value={formatPercent(completedProfile?.roiTemplate.metrics.requestedCoverage)} />
            <Metric label="Empirical Coverage" value={formatPercent(completedProfile?.roiTemplate.metrics.empiricalCoverage)} />
            <Metric label="Method" value={completedProfile?.roiTemplate.estimationMethod ?? "-"} />
            <Metric label="Source" value={completedProfile?.roiTemplate.source ?? "-"} />
            <Metric label="Fallback Reason" value={completedProfile?.roiTemplate.fallbackReason ?? "-"} />
            <Metric label="Major Radius" value={formatNumber(completedProfile?.roiTemplate.radiusMajor)} />
            <Metric label="Minor Radius" value={formatNumber(completedProfile?.roiTemplate.radiusMinor)} />
            <Metric label="Rotation Rad" value={formatNumber(completedProfile?.roiTemplate.rotationRad)} />
            <Metric label="Area px2" value={formatNumber(completedProfile?.roiTemplate.metrics.roiAreaPx2)} />
            <Metric
              label="Clamp"
              value={completedProfile === null
                ? "-"
                : `major=${completedProfile.roiTemplate.metrics.majorRadiusClamped}, minor=${completedProfile.roiTemplate.metrics.minorRadiusClamped}`}
            />
          </DebugGroup>

          <DebugGroup title="Active Profile">
            <Metric label="Profile ID" value={activeProfile?.id ?? "-"} />
            <Metric label="Version" value={activeProfile?.version ?? "-"} />
            <Metric
              label="Mode"
              value={activeProfile?.mode === "smooth-pursuit"
                ? "smooth-pursuit"
                : activeProfile === null ? "-" : "fixed-grid"}
            />
            <Metric label="Quality" value={activeProfile?.quality ?? "-"} />
            <Metric
              label="Created"
              value={completedProfile !== null && completedProfile.id === activeProfile?.id
                ? String(completedProfile.createdAtMs)
                : "-"}
            />
          </DebugGroup>

          <DebugGroup title="Latest Timeline Calibration">
            <Metric label="Frame" value={latestTimelineSample?.observation.frameId ?? "-"} />
            <Metric label="Profile ID" value={latestCalibration?.calibration.profileId ?? "-"} />
            <Metric label="Version" value={latestCalibration?.calibration.version ?? "-"} />
            <Metric
              label="Viewport Point"
              value={latestCalibration === null || latestCalibration === undefined
                ? "Raw-only"
                : `${formatNumber(latestCalibration.viewportPoint.x)}, ${formatNumber(latestCalibration.viewportPoint.y)}`}
            />
            <Metric label="Coverage" value={formatPercent(latestCalibration?.confidenceRoi.coverageProbability)} />
            <Metric
              label="ROI"
              value={latestCalibration === null || latestCalibration === undefined
                ? "-"
                : `${formatNumber(latestCalibration.confidenceRoi.radiusMajor)} x ${formatNumber(latestCalibration.confidenceRoi.radiusMinor)} (${latestCalibration.confidenceRoi.source})`}
            />
            <Metric label="PDF Hit" value={formatPdfHit(latestCalibration?.pdfHit)} />
          </DebugGroup>
        </div>
      </section>
    </>
  );
}

function DebugGroup({
  title,
  children,
}: Readonly<{
  readonly title: string;
  readonly children: React.ReactNode;
}>): React.ReactElement {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="mt-2 space-y-1 text-xs">{children}</dl>
    </div>
  );
}

function Metric({
  label,
  value,
}: Readonly<{
  readonly label: string;
  readonly value: string | number;
}>): React.ReactElement {
  return (
    <div className="flex justify-between gap-3">
      <dt className="font-medium text-slate-600">{label}</dt>
      <dd className="break-all text-right text-slate-900">{value}</dd>
    </div>
  );
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "-";
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatRejectionCounts(rejectionCounts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(rejectionCounts);
  return entries.length === 0
    ? "-"
    : entries.map(([reason, count]) => `${reason}:${count}`).join(", ");
}

function formatPdfHit(
  pdfHit: NonNullable<TimedGazeSample["calibrationData"]>["pdfHit"] | undefined,
): string {
  if (pdfHit === null || pdfHit === undefined) {
    return "Rect unavailable";
  }
  const location = pdfHit.isInsidePdfViewport
    ? "Inside PDF Viewport"
    : "Outside PDF Viewport";
  return [
    location,
    `local=(${formatNumber(pdfHit.localPoint.x)}, ${formatNumber(pdfHit.localPoint.y)})`,
    `normalized=(${formatNumber(pdfHit.normalizedPoint.x)}, ${formatNumber(pdfHit.normalizedPoint.y)})`,
  ].join(" / ");
}

export function getCalibrationErrorMessage(code: PursuitCalibrationErrorCode): string {
  switch (code) {
    case "insufficient-calibration-samples":
      return "충분한 시선 데이터를 수집하지 못했습니다.";
    case "lag-estimation-failed":
      return "표적 움직임과 시선 움직임을 안정적으로 맞추지 못했습니다.";
    case "affine-fitting-failed":
      return "화면 좌표 보정 모델을 만들지 못했습니다.";
    case "insufficient-validation-samples":
      return "검증 시선 데이터가 부족합니다.";
    case "confidence-roi-failed":
      return "시선 오차 영역을 계산하지 못했습니다.";
    case "viewport-changed":
      return "보정 중 PDF 영역 크기가 변경되었습니다.";
    default:
      return "Smooth Pursuit Calibration을 완료하지 못했습니다.";
  }
}

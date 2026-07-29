import type { TimedGazeSample } from "@ggulnote/interaction-core";

const CALIBRATED_GAZE_Z_INDEX = 30;

export type CalibratedGazeOverlayProps = Readonly<{
  readonly sample: TimedGazeSample | null;
}>;

/**
 * Displays the exact calibrated point and Generic ROI stored in the Timeline.
 * It intentionally performs no calibration or ROI estimation.
 */
export function CalibratedGazeOverlay({
  sample,
}: CalibratedGazeOverlayProps): React.ReactElement | null {
  const calibrationData = sample?.calibrationData;
  if (calibrationData === null || calibrationData === undefined) {
    return null;
  }

  const { viewportPoint, confidenceRoi, calibration } = calibrationData;
  const rotationDeg = confidenceRoi.rotationRad * 180 / Math.PI;

  return (
    <svg
      aria-hidden="true"
      data-profile-id={calibration.profileId}
      data-profile-version={calibration.version}
      data-roi-coverage={confidenceRoi.coverageProbability}
      data-roi-source={confidenceRoi.source}
      data-testid="calibrated-gaze-overlay"
      height="100%"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: CALIBRATED_GAZE_Z_INDEX,
      }}
      width="100%"
    >
      <ellipse
        cx={viewportPoint.x}
        cy={viewportPoint.y}
        data-testid="calibrated-confidence-roi"
        fill={confidenceRoi.source === "fallback"
          ? "rgba(217, 119, 6, 0.12)"
          : "rgba(14, 116, 144, 0.12)"}
        rx={confidenceRoi.radiusMajor}
        ry={confidenceRoi.radiusMinor}
        stroke={confidenceRoi.source === "fallback" ? "#d97706" : "#0e7490"}
        strokeDasharray={confidenceRoi.source === "fallback" ? "6 4" : undefined}
        strokeWidth="2"
        transform={`rotate(${rotationDeg} ${viewportPoint.x} ${viewportPoint.y})`}
      />
      <circle
        cx={viewportPoint.x}
        cy={viewportPoint.y}
        data-testid="calibrated-gaze-point"
        fill="#dc2626"
        r="5"
        stroke="white"
        strokeWidth="2"
      />
    </svg>
  );
}

import type {
  AxisAlignedBounds,
  ViewportPoint,
  ViewportRect,
  RawGazeVector,
} from "./calibration-types";

export type PursuitTrajectoryRole = "calibration" | "validation";

export type NormalizedViewportPoint = Readonly<{
  readonly x: number;
  readonly y: number;
}>;

export type PursuitTrajectorySegment<
  TRole extends PursuitTrajectoryRole = PursuitTrajectoryRole,
> = Readonly<{
  readonly id: string;
  readonly from: NormalizedViewportPoint;
  readonly to: NormalizedViewportPoint;
  readonly role: TRole;
}>;

export type PursuitTrajectory<
  TRole extends PursuitTrajectoryRole = PursuitTrajectoryRole,
> = Readonly<{
  readonly id: string;
  readonly role: TRole;
  readonly segments: readonly PursuitTrajectorySegment<TRole>[];
}>;

export type CalibrationTrajectorySegment = PursuitTrajectorySegment<"calibration">;
export type ValidationTrajectorySegment = PursuitTrajectorySegment<"validation">;
export type CalibrationTrajectory = PursuitTrajectory<"calibration">;
export type ValidationTrajectory = PursuitTrajectory<"validation">;

export type PursuitDirectionVector = Readonly<{
  readonly x: number;
  readonly y: number;
}>;

export type PursuitTargetBounds = AxisAlignedBounds;
export type PursuitViewportRect = ViewportRect;
export type PursuitViewportPoint = ViewportPoint;

export type PursuitTrajectoryPhase =
  | "initial-hold"
  | "moving"
  | "segment-stop"
  | "endpoint-hold"
  | "direction-cue"
  | "settling"
  | "completed";

export type PursuitMovementStage = "warmup" | "sampling" | "cooldown";

export type PursuitTrajectoryState = Readonly<{
  readonly trajectoryId: string;
  readonly role: PursuitTrajectoryRole;
  readonly phase: PursuitTrajectoryPhase;
  readonly elapsedMs: number;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly segmentElapsedMs: number;
  readonly segmentDurationMs: number;
  readonly segmentProgress: number;
  readonly targetCenter: ViewportPoint;
  readonly targetBounds: PursuitTargetBounds;
  readonly nextDirection: PursuitDirectionVector | null;
  readonly movementStage: PursuitMovementStage | null;
  readonly isSampleEligible: boolean;
  readonly isComplete: boolean;
}>;

export type PursuitSpatialBin = Readonly<{
  readonly x: number;
  readonly y: number;
}>;

export type PursuitRawSample = Readonly<{
  readonly sessionId: string;
  readonly segmentId: string;
  readonly role: PursuitTrajectoryRole;

  readonly timestampMs: number;

  readonly rawVector: RawGazeVector;
  readonly smoothedVector?: RawGazeVector;

  readonly targetCenter: ViewportPoint;
  readonly targetBounds: PursuitTargetBounds;

  readonly frameId?: number;
  readonly sequenceId?: number;
  readonly trackingQuality?: number;
}>;

export type PursuitRawSampleWithBin = Readonly<PursuitRawSample & {
  readonly spatialBin: PursuitSpatialBin;
}>;

export type PursuitSampleRejectionReason =
  | "wrong-session"
  | "wrong-segment"
  | "wrong-role"
  | "outside-collection-window"
  | "movement-warmup"
  | "movement-cooldown"
  | "duplicate-frame"
  | "duplicate-sequence"
  | "late-sample"
  | "invalid-vector"
  | "tracking-unavailable"
  | "tracking-quality"
  | "sampling-interval"
  | "spatial-bin-limit"
  | "collector-inactive";

export type PursuitSampleAcceptanceResult =
  | Readonly<{ readonly ok: true; readonly sample: PursuitRawSampleWithBin }>
  | Readonly<{ readonly ok: false; readonly reason: PursuitSampleRejectionReason }>;

export type PursuitTargetHistorySample = Readonly<{
  readonly timestampMs: number;
  readonly segmentId: string;
  readonly role: PursuitTrajectoryRole;
  readonly targetCenter: ViewportPoint;
}>;

export type PursuitSegmentCollectionStats = Readonly<{
  readonly segmentId: string;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejectionCounts: Readonly<Record<string, number>>;
  readonly spatialBinCount: number;
}>;

export const PURSUIT_SAMPLE_REJECTION_REASONS: readonly PursuitSampleRejectionReason[] = [
  "wrong-session",
  "wrong-segment",
  "wrong-role",
  "outside-collection-window",
  "movement-warmup",
  "movement-cooldown",
  "duplicate-frame",
  "duplicate-sequence",
  "late-sample",
  "invalid-vector",
  "tracking-unavailable",
  "tracking-quality",
  "sampling-interval",
  "spatial-bin-limit",
  "collector-inactive",
] as const;

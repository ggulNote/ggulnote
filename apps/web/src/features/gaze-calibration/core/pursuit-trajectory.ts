import {
  validatePursuitCalibrationConfig,
  type PursuitCalibrationConfig,
  type PursuitMotionConfig,
  type PursuitTargetConfig,
} from "../config/pursuit-calibration-config";
import type {
  ViewportPoint,
  ViewportRect,
} from "../domain/calibration-types";
import type {
  NormalizedViewportPoint,
  PursuitDirectionVector,
  PursuitMovementStage,
  PursuitTargetBounds,
  PursuitTrajectory,
  PursuitTrajectoryPhase,
  PursuitTrajectorySegment,
  PursuitTrajectoryState,
} from "../domain/pursuit-types";

const MILLISECONDS_PER_SECOND = 1000;

export type PursuitTrajectoryErrorKind =
  | "config-invalid"
  | "elapsed-time-invalid"
  | "trajectory-invalid"
  | "viewport-invalid";

export class PursuitTrajectoryError extends Error {
  public readonly kind: PursuitTrajectoryErrorKind;

  public constructor(kind: PursuitTrajectoryErrorKind, message: string) {
    super(message);
    this.name = "PursuitTrajectoryError";
    this.kind = kind;
  }
}

export type PursuitTrajectoryStateInput = Readonly<{
  readonly trajectory: PursuitTrajectory;
  readonly viewportRect: ViewportRect;
  readonly config: PursuitCalibrationConfig;
  readonly elapsedMs: number;
}>;

export function normalizedPointToViewportPoint(
  point: NormalizedViewportPoint,
  viewportRect: ViewportRect,
  targetConfig: PursuitTargetConfig,
): ViewportPoint {
  assertNormalizedPoint(point);
  const safeArea = getTargetCenterArea(viewportRect, targetConfig);

  return {
    x: safeArea.left + (safeArea.right - safeArea.left) * point.x,
    y: safeArea.top + (safeArea.bottom - safeArea.top) * point.y,
  };
}

export function getTargetBounds(
  center: ViewportPoint,
  targetConfig: PursuitTargetConfig,
): PursuitTargetBounds {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new PursuitTrajectoryError("viewport-invalid", "Target center must contain finite coordinates.");
  }

  if (!Number.isFinite(targetConfig.diameterPx) || targetConfig.diameterPx <= 0) {
    throw new PursuitTrajectoryError("config-invalid", "Target diameter must be finite and positive.");
  }

  const radius = targetConfig.diameterPx / 2;
  return {
    left: center.x - radius,
    top: center.y - radius,
    right: center.x + radius,
    bottom: center.y + radius,
  };
}

export function getSegmentTargetCenter(
  segment: PursuitTrajectorySegment,
  progress: number,
  viewportRect: ViewportRect,
  targetConfig: PursuitTargetConfig,
): ViewportPoint {
  if (!Number.isFinite(progress)) {
    throw new PursuitTrajectoryError("elapsed-time-invalid", "Segment progress must be finite.");
  }

  const from = normalizedPointToViewportPoint(segment.from, viewportRect, targetConfig);
  const to = normalizedPointToViewportPoint(segment.to, viewportRect, targetConfig);
  const clampedProgress = clamp(progress, 0, 1);

  return {
    x: from.x + (to.x - from.x) * clampedProgress,
    y: from.y + (to.y - from.y) * clampedProgress,
  };
}

export function getSegmentDurationMs(
  segment: PursuitTrajectorySegment,
  viewportRect: ViewportRect,
  config: PursuitCalibrationConfig,
): number {
  assertValidConfig(config);
  return calculateSegmentDurationMs(segment, viewportRect, config);
}

export function getSegmentDirectionVector(
  segment: PursuitTrajectorySegment,
): PursuitDirectionVector | null {
  return normalizeDirection({
    x: segment.to.x - segment.from.x,
    y: segment.to.y - segment.from.y,
  });
}

export function getNextDirectionVector(
  trajectory: PursuitTrajectory,
  currentSegmentIndex: number,
): PursuitDirectionVector | null {
  const nextSegment = trajectory.segments[currentSegmentIndex + 1];
  return nextSegment === undefined ? null : getSegmentDirectionVector(nextSegment);
}

export function getPursuitTrajectoryState(
  input: PursuitTrajectoryStateInput,
): PursuitTrajectoryState {
  assertValidConfig(input.config);
  assertTrajectory(input.trajectory);

  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new PursuitTrajectoryError(
      "elapsed-time-invalid",
      "Trajectory elapsed time must be finite and non-negative.",
    );
  }

  const firstSegment = input.trajectory.segments[0];
  if (firstSegment === undefined) {
    throw new PursuitTrajectoryError("trajectory-invalid", "Trajectory must contain at least one segment.");
  }

  if (input.elapsedMs < input.config.transition.initialHoldMs) {
    return createState({
      input,
      phase: "initial-hold",
      segment: firstSegment,
      segmentIndex: 0,
      segmentElapsedMs: 0,
      segmentDurationMs: calculateSegmentDurationMs(firstSegment, input.viewportRect, input.config),
      segmentProgress: 0,
      nextDirection: getSegmentDirectionVector(firstSegment),
      movementStage: null,
      isComplete: false,
    });
  }

  let segmentStartsAtMs = input.config.transition.initialHoldMs;

  for (let segmentIndex = 0; segmentIndex < input.trajectory.segments.length; segmentIndex += 1) {
    const segment = input.trajectory.segments[segmentIndex];
    if (segment === undefined) {
      throw new PursuitTrajectoryError("trajectory-invalid", "Trajectory segment is missing.");
    }

    const segmentDurationMs = calculateSegmentDurationMs(segment, input.viewportRect, input.config);
    const segmentEndsAtMs = segmentStartsAtMs + segmentDurationMs;

    if (input.elapsedMs < segmentEndsAtMs) {
      const segmentElapsedMs = input.elapsedMs - segmentStartsAtMs;
      const movementStage = getMovementStage(
        segmentElapsedMs,
        segmentDurationMs,
        input.config.motion,
      );

      return createState({
        input,
        phase: "moving",
        segment,
        segmentIndex,
        segmentElapsedMs,
        segmentDurationMs,
        segmentProgress: segmentElapsedMs / segmentDurationMs,
        nextDirection: null,
        movementStage,
        isComplete: false,
      });
    }

    const segmentStopEndsAtMs = segmentEndsAtMs + input.config.transition.segmentStopMs;
    if (input.elapsedMs < segmentStopEndsAtMs) {
      return createEndpointState(
        input,
        "segment-stop",
        segment,
        segmentIndex,
        segmentDurationMs,
      );
    }

    const endpointHoldEndsAtMs = segmentStopEndsAtMs + input.config.transition.endpointHoldMs;
    if (input.elapsedMs < endpointHoldEndsAtMs) {
      return createEndpointState(
        input,
        "endpoint-hold",
        segment,
        segmentIndex,
        segmentDurationMs,
      );
    }

    const isLastSegment = segmentIndex === input.trajectory.segments.length - 1;
    if (isLastSegment) {
      return createEndpointState(
        input,
        "completed",
        segment,
        segmentIndex,
        segmentDurationMs,
        true,
      );
    }

    const directionCueEndsAtMs = endpointHoldEndsAtMs + input.config.transition.directionCueMs;
    if (input.elapsedMs < directionCueEndsAtMs) {
      return createEndpointState(
        input,
        "direction-cue",
        segment,
        segmentIndex,
        segmentDurationMs,
      );
    }

    const settlingEndsAtMs = directionCueEndsAtMs + input.config.transition.settleAfterCueMs;
    if (input.elapsedMs < settlingEndsAtMs) {
      return createEndpointState(
        input,
        "settling",
        segment,
        segmentIndex,
        segmentDurationMs,
      );
    }

    segmentStartsAtMs = settlingEndsAtMs;
  }

  const lastSegmentIndex = input.trajectory.segments.length - 1;
  const lastSegment = input.trajectory.segments[lastSegmentIndex];
  if (lastSegment === undefined) {
    throw new PursuitTrajectoryError("trajectory-invalid", "Trajectory final segment is missing.");
  }

  return createEndpointState(
    input,
    "completed",
    lastSegment,
    lastSegmentIndex,
    calculateSegmentDurationMs(lastSegment, input.viewportRect, input.config),
    true,
  );
}

function createEndpointState(
  input: PursuitTrajectoryStateInput,
  phase: PursuitTrajectoryPhase,
  segment: PursuitTrajectorySegment,
  segmentIndex: number,
  segmentDurationMs: number,
  isComplete = false,
): PursuitTrajectoryState {
  return createState({
    input,
    phase,
    segment,
    segmentIndex,
    segmentElapsedMs: segmentDurationMs,
    segmentDurationMs,
    segmentProgress: 1,
    nextDirection: getNextDirectionVector(input.trajectory, segmentIndex),
    movementStage: null,
    isComplete,
  });
}

function createState(options: Readonly<{
  readonly input: PursuitTrajectoryStateInput;
  readonly phase: PursuitTrajectoryPhase;
  readonly segment: PursuitTrajectorySegment;
  readonly segmentIndex: number;
  readonly segmentElapsedMs: number;
  readonly segmentDurationMs: number;
  readonly segmentProgress: number;
  readonly nextDirection: PursuitDirectionVector | null;
  readonly movementStage: PursuitMovementStage | null;
  readonly isComplete: boolean;
}>): PursuitTrajectoryState {
  const targetCenter = getSegmentTargetCenter(
    options.segment,
    options.segmentProgress,
    options.input.viewportRect,
    options.input.config.target,
  );

  return {
    trajectoryId: options.input.trajectory.id,
    role: options.input.trajectory.role,
    phase: options.phase,
    elapsedMs: options.input.elapsedMs,
    segmentIndex: options.segmentIndex,
    segmentId: options.segment.id,
    segmentElapsedMs: options.segmentElapsedMs,
    segmentDurationMs: options.segmentDurationMs,
    segmentProgress: clamp(options.segmentProgress, 0, 1),
    targetCenter,
    targetBounds: getTargetBounds(targetCenter, options.input.config.target),
    nextDirection: options.nextDirection,
    movementStage: options.movementStage,
    isSampleEligible: options.phase === "moving" && options.movementStage === "sampling",
    isComplete: options.isComplete,
  };
}

function calculateSegmentDurationMs(
  segment: PursuitTrajectorySegment,
  viewportRect: ViewportRect,
  config: PursuitCalibrationConfig,
): number {
  const from = normalizedPointToViewportPoint(segment.from, viewportRect, config.target);
  const to = normalizedPointToViewportPoint(segment.to, viewportRect, config.target);
  const distancePx = Math.hypot(to.x - from.x, to.y - from.y);

  if (!Number.isFinite(distancePx) || distancePx <= 0) {
    throw new PursuitTrajectoryError(
      "trajectory-invalid",
      `Trajectory segment "${segment.id}" must have a positive viewport distance.`,
    );
  }

  return distancePx / config.motion.speedPxPerSecond * MILLISECONDS_PER_SECOND;
}

function getMovementStage(
  segmentElapsedMs: number,
  segmentDurationMs: number,
  motionConfig: PursuitMotionConfig,
): PursuitMovementStage {
  const samplingStartsAtMs = Math.min(motionConfig.movementWarmupMs, segmentDurationMs);
  const samplingEndsAtMs = Math.max(
    samplingStartsAtMs,
    segmentDurationMs - motionConfig.movementCooldownMs,
  );

  if (segmentElapsedMs < samplingStartsAtMs) {
    return "warmup";
  }

  if (segmentElapsedMs >= samplingEndsAtMs) {
    return "cooldown";
  }

  return "sampling";
}

function getTargetCenterArea(
  viewportRect: ViewportRect,
  targetConfig: PursuitTargetConfig,
): PursuitTargetBounds {
  if (
    !Number.isFinite(viewportRect.left)
    || !Number.isFinite(viewportRect.top)
    || !Number.isFinite(viewportRect.width)
    || !Number.isFinite(viewportRect.height)
    || viewportRect.width <= 0
    || viewportRect.height <= 0
  ) {
    throw new PursuitTrajectoryError(
      "viewport-invalid",
      "Viewport rect must contain finite coordinates and positive dimensions.",
    );
  }

  if (
    !Number.isFinite(targetConfig.diameterPx)
    || targetConfig.diameterPx <= 0
    || !Number.isFinite(targetConfig.viewportInsetPx)
    || targetConfig.viewportInsetPx < 0
  ) {
    throw new PursuitTrajectoryError(
      "config-invalid",
      "Target diameter must be positive and viewport inset must be non-negative.",
    );
  }

  const targetMargin = targetConfig.diameterPx / 2 + targetConfig.viewportInsetPx;
  const safeArea = {
    left: viewportRect.left + targetMargin,
    top: viewportRect.top + targetMargin,
    right: viewportRect.left + viewportRect.width - targetMargin,
    bottom: viewportRect.top + viewportRect.height - targetMargin,
  };

  if (safeArea.left >= safeArea.right || safeArea.top >= safeArea.bottom) {
    throw new PursuitTrajectoryError(
      "viewport-invalid",
      "Viewport is too small for the configured target diameter and inset.",
    );
  }

  return safeArea;
}

function assertValidConfig(config: PursuitCalibrationConfig): void {
  const result = validatePursuitCalibrationConfig(config);
  if (!result.ok) {
    throw new PursuitTrajectoryError("config-invalid", result.error.message);
  }
}

function assertTrajectory(trajectory: PursuitTrajectory): void {
  if (trajectory.id.trim().length === 0 || trajectory.segments.length === 0) {
    throw new PursuitTrajectoryError(
      "trajectory-invalid",
      "Trajectory must have an id and at least one segment.",
    );
  }

  const segmentIds = new Set<string>();
  for (const segment of trajectory.segments) {
    if (
      segment.id.trim().length === 0
      || segment.role !== trajectory.role
      || segmentIds.has(segment.id)
    ) {
      throw new PursuitTrajectoryError(
        "trajectory-invalid",
        "Trajectory segments must have unique ids and match the trajectory role.",
      );
    }

    assertNormalizedPoint(segment.from);
    assertNormalizedPoint(segment.to);
    segmentIds.add(segment.id);
  }
}

function assertNormalizedPoint(point: NormalizedViewportPoint): void {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.x > 1
    || point.y < 0
    || point.y > 1
  ) {
    throw new PursuitTrajectoryError(
      "trajectory-invalid",
      "Normalized trajectory coordinates must be finite and inside [0, 1].",
    );
  }
}

function normalizeDirection(
  vector: PursuitDirectionVector,
): PursuitDirectionVector | null {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return null;
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
